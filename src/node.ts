import jaysom from 'jayson/promise'
import { Mutex } from 'async-mutex'

import { multicast, createSeqIterator, withTimeout, PromiseHandler, digestMsg, createPromiseHandler } from './util'
import { NodeConfig, SystemConfig } from './config'
import { Automata } from './automata'
import { NamedLogger } from './logger'
import assert from 'assert'
import {
    CommitMsg,
    CommittedLogMsg,
    ErrorCode,
    ErrorWithCode,
    MasterInfoMsg,
    Message,
    PrePrepareMsg,
    PrepareMsg,
    PreparedLogMsg,
    QueryAutomataMsg,
    RequestMsg, createErrorMsg, createOkMsg, requires, CheckpointMsg
} from './message'
import { Optional } from './types'
import { Logs } from './logs'

function calcMaster(view: number, nodes: NodeConfig[]) {
    const masterIndex = view % nodes.length
    return nodes[masterIndex]
}

export enum NodeStatus {
    Idle = 'idle',
    PrePrepared = 'pre-prepared',
    Prepared = 'prepared',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<T extends Message> = (msg: T) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Routes = { [key: string]: RouteHandler<any> };

export class Node<TStatus> {
    config: NodeConfig
    logger: NamedLogger
    nodes: Map<string, jaysom.client> = new Map() // name -> client
    view: number = 0
    systemConfig: SystemConfig
    seq = createSeqIterator()
    // is equal to the sequence number of the last stable checkpoint.
    lowWaterMark = 0
    get highWaterMark() {
        return this.lowWaterMark + this.systemConfig.params.k
    }
    get lastStableSeq() {
        return this.lowWaterMark
    }
    // logs are all the VALID messages received. it periodically get cleaned.
    // the logs work as a buffer, and entries are used to vote, validate
    logs!: Logs

    mutex = new Mutex()

    getRequest(digest: string) {
        return (this.logs.first(
            x => x.type === 'pre-prepare'
                && x.sequence === this.seq.peek()
                && x.digest === digest
        ) as Optional<PrePrepareMsg>)?.request
    }

    _height = 0

    get height() {
        return this._height
    }

    set height(h: number) {
        this._height = h
        this.logger.debug('height changed to', h)
    }

    automata: Automata<TStatus>

    get master() {
        return calcMaster(this.view, this.systemConfig.nodes)
    }

    isMaster() {
        return this.master.name === this.name
    }

    get name() {
        return this.config.name
    }

    _status: NodeStatus = NodeStatus.Idle
    get status() {
        return this._status
    }
    set status(s: NodeStatus) {
        this._status = s
        this.logger.debug('status switched to', s)
    }

    constructor(meta: NodeConfig, config: SystemConfig, automata: Automata<TStatus>) {
        this.logger = new NamedLogger(meta.name)
        this.logs = new Logs(this.logger.derived('log'), digestMsg)
        this.config = meta
        this.systemConfig = config
        this.automata = automata

        this.systemConfig.nodes.map((node) => {
            const client = jaysom.client.http({
                host: node.host,
                port: node.port,
            })
            this.nodes.set(node.name, client)
        })
    }

    routes() {
        const wrapper = (routes: Routes): Routes => {
            return Object.fromEntries(Object.entries(routes).map(([key, handler]): [string, typeof handler] => {
                return [key, async (msg) => {
                    const logger = this.logger.derived('routes/' + key)
                    logger.debug('recv', msg)
                    try {
                        const ret = await handler(msg) as Message
                        if (ret.type === 'error') {
                            logger.error('resp', ret)
                        } else {
                            logger.debug('resp', ret)
                        }
                        return ret
                    } catch (error) {
                        logger.error(error)
                        const ret = error instanceof ErrorWithCode ? createErrorMsg(error.code, error.message) : {
                            type: 'error',
                            code: ErrorCode.Unknown,
                            message: (error as Error).message,
                        }
                        return ret
                    }
                }]
            }))
        }

        return wrapper(this._routes())
    }

    onRequestDone(msg: RequestMsg) {
        this.logger.debug('onRequestCommitted', msg)
        this.height++
        this.checkpoint()
    }

    checkpoint() {
        if (this.height % this.systemConfig.params.k !== 0) {
            return
        }

        const logger = this.logger.derived('checkpoint')

        const lastCommitted = this.logs.last(x => x.type === 'committed') as Optional<CommittedLogMsg>
        if (!lastCommitted) {
            logger.error('no last commit found but checkpoint triggered. if you see this message, it\'s a bug')
            return
        }

        // create checkpoint message
        const checkpointMsg: CheckpointMsg = {
            type: 'checkpoint',
            sequence: lastCommitted.sequence,
            digest: this.automata.digest(), // digest of the state machine
            node: this.name,
        }

        // boardcast checkpoint message
        this.logBoardcast(this.boardcast(checkpointMsg))
    }

    logBoardcast(promise: Promise<Message[]>) {
        promise.then((rets) => {
            this.logger.debug('boardcasted', rets)
        }).catch((error) => {
            this.logger.error('boardcast error', error)
        })
    }

    _routes(): Routes {
        const domainRoutes: Routes = {
            'query-status': async () => {
                return {
                    status: 'ok',
                    view: this.view,
                    master: this.master.name,
                    automata: this.automata.status(),
                    params: this.systemConfig.params,
                }
            },
            'query-automata': async ({ command }: QueryAutomataMsg) => {
                return {
                    type: 'ok',
                    message: await this.automata.query(command),
                }
            },
            'find-master': async () => {
                const ret: MasterInfoMsg = {
                    type: 'master-info',
                    name: this.master.name,
                }
                return ret
            },
        }
        let signal: Optional<PromiseHandler<void>> = undefined
        const consensusRoutes: Routes = {
            'request': async (msg: RequestMsg): Promise<Message> => {
                const release = await this.mutex.acquire()
                try {
                    const logger = this.logger.derived('routes/request')
                    requires(this.master.name === this.name, ErrorCode.NotMaster)
                    requires(this.status === NodeStatus.Idle, ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Idle}`)
                    requires(this.seqValid(this.seq.peek()), ErrorCode.InvalidSequence)

                    signal = createPromiseHandler<void>()

                    const n = this.seq.next()
                    const prePrepareMsg: PrePrepareMsg = {
                        type: 'pre-prepare',
                        view: this.view,
                        sequence: n,
                        digest: digestMsg(msg),
                        request: msg,
                    }
                    this.logBoardcast(this.boardcast(prePrepareMsg))

                    // now await for pre-prepare, prepare and commit
                    await signal.promise
                    signal = undefined

                    requires(this.logs.last(
                        x => x.type === 'committed'
                            && x.digest === prePrepareMsg.digest
                            && x.view == this.view
                            && x.sequence === n
                    ) !== undefined, ErrorCode.InternalError, 'no commit message found for request')

                    logger.debug('requesting reset')

                    assert.equal(signal, undefined)
                    assert.equal(this.status, NodeStatus.Idle)
                    this.onRequestDone(msg)
                    return createOkMsg()
                } finally {
                    release()
                }
            },

            // a pre-prepare should be sent by master and receive only once
            'pre-prepare': async (msg: PrePrepareMsg) => {
                // alter status
                requires(this.status === NodeStatus.Idle, ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Idle}`)

                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)
                requires(msg.view === this.view, ErrorCode.InvalidView)

                const digest = digestMsg(msg.request)
                requires(digest === msg.digest, ErrorCode.InvalidDigest)
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg)

                // if msg already prepared or committed, then return ok
                if (this.logs.last(
                    x => x.type === 'commit'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )) {
                    return createOkMsg('already committed, no need to pre-prepare')
                }

                if (this.logs.last(
                    x => x.type === 'prepare'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )) {
                    return createOkMsg('already prepared, no need to pre-prepare')
                }
                this.logs.append(msg)

                // mutate state
                this.status = NodeStatus.PrePrepared

                // create and boardcast prepare message
                const prepareMsg: PrepareMsg = {
                    type: 'prepare',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }

                this.logBoardcast(this.boardcast(prepareMsg))

                return createOkMsg('prepare boardcasted')
            },
            // prepare messages are sent by all pre-prepared nodes and will be received many times
            // when a PrepareMsg is received, the tx may have been prepared, and even committed locally (or not)
            'prepare': async (msg: PrepareMsg) => {
                const logger = this.logger.derived('routes/prepare')
                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)

                // msg should be pre-prepared
                const prePrepareLog = this.logs.last(
                    x => x.type === 'pre-prepare'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )
                requires(prePrepareLog !== undefined, ErrorCode.InvalidStatus, 'no pre-prepare message found for msg')
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated prepare message')

                // status validation
                requires(this.getRequest(msg.digest) !== undefined, ErrorCode.InvalidStatus, 'no current request')
                //  msg validation
                requires(msg.view === this.view, ErrorCode.InvalidView, `msg.view is ${msg.view}, expect ${this.view}`)
                this.logs.append(msg)

                const count = this.logs.count(
                    x => x.type === 'prepare'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )
                if (count <= 2 * this.systemConfig.params.f) {
                    requires(this.status === NodeStatus.PrePrepared, ErrorCode.InternalError, `status is ${this.status}, should be ${NodeStatus.PrePrepared}`)
                }


                logger.debug('count', count)
                if (count <= 2 * this.systemConfig.params.f) {
                    return createOkMsg('pre-preparing')
                }

                if (this.logs.first(
                    x => x.type === 'prepared'
                        && x.node === this.name
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )) {
                    return createOkMsg('already prepared due to more than 2f prepare messages')
                }

                const confirm: PreparedLogMsg = {
                    type: 'prepared',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }
                this.logs.append(confirm)

                logger.debug('preparing count enough, prepared')
                // this.preparing.prepared = true
                this.status = NodeStatus.Prepared

                // create and boardcast commit message
                const commitMsg: CommitMsg = {
                    type: 'commit',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }

                const ret = await this.boardcast(commitMsg)
                logger.debug('ret', ret)
                return {
                    message: 'commit boardcasted'
                }
            },
            // commit messages are sent by all prepared nodes and will be received many times
            // when a CommitMsg is received, the tx may have been committed locally or not
            'commit': async (msg: CommitMsg) => {
                const logger = this.logger.derived('routes/commit')
                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)
                // prevent duplicated commit
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated commit message')

                if (this.logs.first(
                    x => x.type === 'committed'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                        && x.node === this.name
                )) {
                    return createOkMsg('already committed due to more than 2f commit messages')
                } else {
                    requires(this.status !== NodeStatus.Idle, ErrorCode.InternalError, 'idle and not committed')
                }

                // a pre-prepare should exists in logs
                const log = this.logs.first(
                    x => x.type === 'pre-prepare'
                        && x.sequence === msg.sequence
                        && x.digest === msg.digest
                ) as Optional<PrePrepareMsg>

                if (!log) {
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, 'no related pre-prepare message found for commit message')
                }

                requires(this.status === NodeStatus.Prepared, ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Prepared}`)
                requires(msg.view === this.view, ErrorCode.InvalidView)
                this.logs.append(msg)

                const count = this.logs.count(
                    x => x.type === 'commit'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )

                if (count <= 2 * this.systemConfig.params.f) {
                    return createOkMsg('preparing')
                }

                logger.debug('collected enough commit messages')
                // mutate state
                const request = this.getRequest(msg.digest)
                if (!request) {
                    throw new ErrorWithCode(ErrorCode.InternalError, 'a related request should exists')
                }

                logger.debug('commiting')
                await this.automata.transfer(request.payload)

                const confirm: CommittedLogMsg = {
                    type: 'committed',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }
                this.logs.append(confirm)

                if (this.isMaster()) {
                    assert(signal !== undefined)
                    logger.debug('master, signal request done')
                    signal.resolver()
                }
                this.status = NodeStatus.Idle
                return {
                    message: 'committed'
                }
            }
        }

        const viewChangeRoutes: Routes = {
            // when a node received 2f+1 checkpoint messages with same seq and digest,
            // a stable checkpoint is reached, and it can safely discard all logs
            // of which the seq is less than that of the checkpoint
            'checkpoint': async (msg: CheckpointMsg) => {
                const logger = this.logger.derived('routes/checkpoint')

                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated checkpoint message from same node')

                this.logs.append(msg)

                const count = this.logs.count(
                    x => x.type === 'checkpoint' && x.sequence === msg.sequence && x.digest === msg.digest
                )

                if (count <= 2 * this.systemConfig.params.f) {
                    return {
                        type: 'ok',
                        message: 'checkpoint voted'
                    }
                }

                logger.debug('stable checkpoint reached')
                this.lowWaterMark = msg.sequence

                logger.debug(`clear logs with seq < ${msg.sequence}`)
                this.logs.clear(x => x.sequence < msg.sequence)

                return {
                    type: 'ok',
                    message: 'checkpoint created'
                }
            },
            'view-change': async () => {
                return {
                    message: 'ok'
                }
            },
            'new-view': async () => {
                return {
                    message: 'ok'
                }
            },
        }

        return {
            ...domainRoutes,
            ...consensusRoutes,
            ...viewChangeRoutes
        }
    }

    async boardcast<T extends Message>(payload: T, timeout: number = 3000): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return withTimeout(multicast(nodes, payload), timeout, 'boardcast timeout')
    }

    seqValid(seq: number) {
        return this.lowWaterMark <= seq && seq <= this.highWaterMark
    }
}
