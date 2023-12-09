import jaysom from 'jayson/promise'

import { multicast, createSeqIterator, deepEquals, sha256, withTimeout } from './util'
import { NodeConfig, SystemConfig } from './config'
import { Automata } from './automata'
import { NamedLogger } from './logger'
import assert from 'assert'
import {
    CommitMsg,
    CommittedLogMsg,
    ErrorCode,
    ErrorMsg,
    ErrorWithCode,
    MasterInfoMsg,
    Message,
    PrePrepareMsg,
    PrepareMsg,
    PreparedLogMsg,
    QueryAutomataMsg,
    RequestMsg, createOkMsg
} from './message'
import { Optional } from './types'

function calcMaster(view: number, nodes: NodeConfig[]) {
    const masterIndex = view % nodes.length
    return nodes[masterIndex]
}

function createMsgDigest<T extends Message>(msg: T) {
    return sha256(JSON.stringify(msg))
}

function createPromiseHandler<T>(message?: string, timeout: number = 3000) {
    let resolver: (value: T | PromiseLike<T>) => void, rejecter: (reason?: Error) => void
    let timeoutHandle: NodeJS.Timeout
    let done = false

    const promise = new Promise<T>((resolve, reject) => {
        resolver = (value: T | PromiseLike<T>) => {
            clearTimeout(timeoutHandle)
            done = true
            resolve(value)
        }
        rejecter = (reason?: Error) => {
            clearTimeout(timeoutHandle)
            done = true
            reject(reason)
        }

        if (timeout > 0) {
            timeoutHandle = setTimeout(() => {
                if (!done) {
                    reject(new Error(message ?? 'timeout'))
                }
            }, timeout)
        }
    })

    return {
        promise,
        resolver: resolver!,
        rejecter: rejecter!
    }
}


export type PromiseHandler<T> = ReturnType<typeof createPromiseHandler<T>>

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
    // logs are all the VALID messages received.
    // periodicaly cleaned.
    logs: (PrePrepareMsg | PrepareMsg | CommitMsg | PreparedLogMsg | CommittedLogMsg)[] = []

    // be careful that the requesting field is only available on the master node
    // due to the fact that only the master node can receive request message
    // if you wanna handle the request message on other nodes, you should
    // search the log and find the corresponding pre-prepare message which
    // contains the request message.
    requesting?: {
        msg: RequestMsg
    } & PromiseHandler<void>
    mutex?: PromiseHandler<void>

    findRequestInLog(digest: string) {
        return (this.logs.find(
            x => x.type === 'pre-prepare'
                && x.sequence === this.seq.peek()
                && x.digest === digest
        ) as Optional<PrePrepareMsg>)?.request
    }

    preparing?: {
        digest: string
        msg: PrepareMsg
        count: number
    }
    // & PromiseHandler<void>

    commiting?: {
        digest: string
        msg: CommitMsg
        count: number
    }

    automata: Automata<TStatus>

    get master() {
        return calcMaster(this.view, this.systemConfig.nodes)
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
                    const logger = this.logger.derived(key)
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
                        const emsg: ErrorMsg = error instanceof ErrorWithCode ? {
                            type: 'error',
                            code: error.code,
                            message: error.message,
                        } : {
                            type: 'error',
                            code: ErrorCode.Unknown,
                            message: (error as Error).message,
                        }
                        return emsg
                    }
                }]
            }))
        }

        return wrapper(this._routes())
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

        const bftRoutes: Routes = {
            'request': async (msg: RequestMsg): Promise<Message> => {
                const logger = this.logger.derived('request')

                if (this.master.name !== this.name) {
                    throw new ErrorWithCode(ErrorCode.NotMaster)
                }

                while (this.mutex) {
                    logger.debug('request mutex waiting')
                    await this.mutex.promise
                    logger.debug('request mutex resolved')
                }
                this.mutex = createPromiseHandler<void>('request wait timeout', 10 * 1000)
                this.requesting = {
                    msg: msg,
                    ...createPromiseHandler<void>('handle user request timeout'),
                }
                const n = this.seq.next()
                const prePrepareMsg: PrePrepareMsg = {
                    type: 'pre-prepare',
                    view: this.view,
                    sequence: n,
                    digest: await createMsgDigest(msg),
                    request: msg,
                }
                logger.debug('boardcast', (prePrepareMsg))
                const ret = await this.boardcast(prePrepareMsg)
                logger.info('ret', ret)
                logger.debug('pre-prepare boardcasted')

                // now await for pre-prepare, prepare and commit
                await this.requesting.promise
                this.requesting = undefined
                logger.debug('requesting reset')
                assert.equal(this.requesting, undefined)
                assert.equal(this.status, NodeStatus.Idle)
                const release = this.mutex.resolver
                this.mutex = undefined
                release()
                return {
                    type: 'ok'
                }
            },

            // a pre-prepare should be sent by master and receive only once
            'pre-prepare': async (msg: PrePrepareMsg) => {
                const logger = this.logger.derived('pre-prepare')
                // msg basic validation
                {
                    if (msg.view !== this.view) {
                        throw new ErrorWithCode(ErrorCode.InvalidView)
                    }

                    const digest = await createMsgDigest(msg.request)
                    if (digest !== msg.digest) {
                        throw new ErrorWithCode(ErrorCode.InvalidDigest)
                    }

                    if (this.logs.find(x => deepEquals(x, msg))) {
                        throw new ErrorWithCode(ErrorCode.DuplicatedMsg)
                    }
                }

                // if msg already prepared or committed, then return ok
                if (this.logs.find(
                    x => x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                        && x.type === 'commit')) {
                    return createOkMsg('already committed, no need to pre-prepare')
                }

                if (this.logs.find(
                    x => x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                        && x.type === 'prepare')) {
                    return createOkMsg('already prepared, no need to pre-prepare')
                }

                // alter status
                if (this.status !== NodeStatus.Idle) {
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Idle}`)
                }

                // mutate state
                this.status = NodeStatus.PrePrepared
                this.logs.push(msg)

                // create and boardcast prepare message
                const prepareMsg: PrepareMsg = {
                    type: 'prepare',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }

                this.preparing = {
                    digest: msg.digest,
                    msg: prepareMsg,
                    count: 0,
                    // ...createPromiseHandler<void>('prepare timeout'),
                }
                logger.debug('boardcast', (prepareMsg))
                this.boardcast(prepareMsg).then((ret) => {
                    logger.debug('boardcast ret', ret)
                }).catch((err) => {
                    logger.error('boardcast err', err)
                })

                return {
                    message: 'prepare boardcasted'
                }
            },
            // prepare messages are sent by all pre-prepared nodes and will be received many times
            // when a PrepareMsg is received, the tx may have been prepared, and even committed locally (or not)
            'prepare': async (msg: PrepareMsg) => {
                const logger = this.logger.derived('prepare')
                // msg should be pre-prepared
                const hasAnyPreprepare = this.logs.find(
                    x => x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === this.seq.peek()
                )
                if (!hasAnyPreprepare) {
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, 'no pre-prepare message found for msg')
                }

                if (this.logs.find(x => deepEquals(x, msg))) {
                    throw new ErrorWithCode(ErrorCode.DuplicatedMsg, 'duplicated prepare message')
                }

                // msg may have been committed
                if (this.logs.find(
                    x => x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === this.seq.peek()
                        && x.type === 'commit')) {
                    return createOkMsg('already committed')
                }

                // status validation
                {
                    if (!this.findRequestInLog(msg.digest)) {
                        throw new ErrorWithCode(ErrorCode.InvalidStatus, 'no current request')
                    }
                    if (!this.preparing) {
                        return createOkMsg('no preparing request')
                    }
                }
                //  msg validation
                {
                    if (msg.view !== this.view) {
                        throw new ErrorWithCode(ErrorCode.InvalidView, `msg.view is ${msg.view}, expect ${this.view}`)
                    }

                    if (msg.digest !== this.preparing.digest) {
                        throw new ErrorWithCode(ErrorCode.InvalidDigest)
                    }
                }

                if (this.logs.find(x => deepEquals(x, msg))) {
                    return createOkMsg('already prepared')
                }

                if (!this.preparing) {
                    return createOkMsg(`not preparing, status is ${this.status}`)
                }

                if (this.preparing.count > 2 * this.systemConfig.params.f) {
                    throw new ErrorWithCode(ErrorCode.InternalError, 'invalid internal state, this.preparing should be undefined')
                } else {
                    if (this.status !== NodeStatus.PrePrepared) {
                        throw new ErrorWithCode(ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.PrePrepared}`)
                    }
                }

                // mutate state
                this.logs.push(msg)
                this.preparing.count++
                logger.debug('count', this.preparing.count)
                if (this.preparing.count <= 2 * this.systemConfig.params.f) {
                    return {
                        message: 'preparing'
                    }
                }

                if (this.logs.find(
                    x => x.type === 'prepared'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === this.seq.peek()
                        && x.node === this.name
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
                this.logs.push(confirm)

                logger.debug('preparing count enough, prepared')
                // this.preparing.prepared = true
                this.status = NodeStatus.Prepared
                this.preparing = undefined


                // create and boardcast commit message
                const commitMsg: CommitMsg = {
                    type: 'commit',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }

                this.commiting = {
                    digest: msg.digest,
                    msg: commitMsg,
                    count: 0,
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
                const logger = this.logger.derived('commit')

                // prevent duplicated commit
                if (this.logs.find(x => deepEquals(x, msg))) {
                    throw new ErrorWithCode(ErrorCode.DuplicatedMsg, 'duplicated commit message')
                }

                if (this.logs.find(
                    x => x.type === 'committed'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === this.seq.peek()
                        && x.node === this.name
                )) {
                    return createOkMsg('already committed due to more than 2f commit messages')
                }

                // may have been committed due to enough commit messages, in this case, we'll 
                if (this.status == NodeStatus.Idle) {
                    // if idle, then it must be committed, but we checked it before, so it's an error
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, 'idle and not committed')
                }

                // committed-local checking
                if (!this.commiting) {
                    // if not commiting, then it must be committed, but we checked it before, so it's an error
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, 'not commiting and not committed')
                }

                if (this.status !== NodeStatus.Prepared) {
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Prepared}`)
                }

                // 1. validate signatures of m and commit msg
                // 2. validate view
                if (msg.view !== this.view) {
                    throw new ErrorWithCode(ErrorCode.InvalidView)
                }
                // 3. validate sequence
                if (!this.isValidSeq(msg.sequence)) {
                    throw new ErrorWithCode(ErrorCode.InvalidSequence,)
                }

                // 4. validate digest
                if (this.commiting?.digest !== msg.digest) {
                    throw new ErrorWithCode(ErrorCode.InvalidDigest)
                }
                if (this.commiting.count === 0) {
                    assert.equal(this.status, NodeStatus.Prepared)
                }

                if (this.commiting.count > 2 * this.systemConfig.params.f) {
                    throw new ErrorWithCode(ErrorCode.InternalError, 'invalid internal state, this.commiting should be undefined')
                }

                // a pre-prepare should exists in logs
                const prePrepareMsg = this.logs.find(
                    x => x.type === 'pre-prepare'
                        && x.sequence === msg.sequence
                        && x.digest === msg.digest
                ) as Optional<PrePrepareMsg>

                if (!prePrepareMsg) {
                    throw new ErrorWithCode(ErrorCode.InvalidStatus, 'no related pre-prepare message found for commit message')
                }

                // mutate state
                this.logs.push(msg)
                this.commiting.count++
                logger.debug('count', this.commiting.count)
                if (this.commiting.count <= 2 * this.systemConfig.params.f) {
                    return {
                        message: 'commiting'
                    }
                }
                logger.debug('commiting count enough')
                const request = this.findRequestInLog(msg.digest)
                if (!request) {
                    throw new ErrorWithCode(ErrorCode.InternalError, 'no related pre-prepare message found for commit message')
                }

                logger.debug('commiting')
                await this.automata.transfer(request.payload)
                logger.debug('commiting reset')

                const confirm: CommittedLogMsg = {
                    type: 'committed',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                    node: this.name,
                }
                this.logs.push(confirm)
                this.commiting = undefined
                if (this.master.name === this.name) {
                    assert(this.requesting !== undefined)
                    logger.debug('requesting resolving')
                    this.requesting.resolver()
                    logger.debug('requesting resolved')
                }
                this.status = NodeStatus.Idle
                return {
                    message: 'committed'
                }
            }
        }

        return {
            ...domainRoutes,
            ...bftRoutes
        }
    }

    async boardcast<T extends Message>(payload: T, timeout: number = 3000): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return withTimeout(multicast(nodes, payload), timeout, 'boardcast timeout')
    }

    async isValidSeq(seq: number) {
        return 0 < seq && seq <= this.seq.peek()
    }
}
