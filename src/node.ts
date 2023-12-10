import { Mutex } from 'async-mutex'
import assert from 'assert'

import { NodeConfig, SystemConfig } from './config'
import { Automata } from './automata'
import { Logger, NamedLogger } from './logger'
import { Optional } from './types'
import { Logs } from './logs'

import {
    multicast,
    createSeqIterator,
    withTimeout,
    PromiseHandler,
    digestMsg,
    createPromiseHandler,
    SeqIterator,
    TimeoutError,
    deepEquals,
    NetworkClient,
    createNetworkClient,
    SignedObject
} from './util'

import {
    ok,
    requires,
    Message,
    CommitMsg,
    CommittedLogMsg,
    ErrorCode,
    RemoteError,
    MasterInfoMsg,
    PrePrepareMsg,
    PrepareMsg,
    PreparedLogMsg,
    QueryAutomataMsg,
    RequestMsg,
    createErrorMsg,
    CheckpointMsg,
    NodeStatusMsg,
    ViewChangeMsg,
    NewViewMsg,
    ReplyMsg,
    SourcedMessage
} from './message'

import { WaitGroup } from './waitgroup'
import { verify } from './sign'

export enum NodeStatus {
    Idle = 'idle',
    PrePrepared = 'pre-prepared',
    Prepared = 'prepared',

    // just for mocking
    _Malicious = '__malicious',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<T extends Message> = (msg: T) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Routes = { [key: string]: RouteHandler<any> };

export class Node<TAutomataStatus> {
    config: NodeConfig
    systemConfig: SystemConfig
    logger: NamedLogger
    nodes: Map<string, NetworkClient> = new Map() // name -> client

    // for graceful shutdown. ensure all async tasks are done before close
    closed = new WaitGroup()

    // logs are all the VALID messages received. it periodically get cleaned.
    // the logs work as a buffer, and entries are used to vote, validate
    logs: Logs
    mutex = new Mutex()

    _seq: SeqIterator // only for master node

    get seq() {
        if (!this.isMaster) {
            throw new Error('only master node has seq iterator')
        }
        return this._seq
    }

    get index() {
        return this.systemConfig.nodes.indexOf(this.config)
    }


    view: number = 0
    nextViewOffset = 0

    get nextView() {
        return (this.view + this.nextViewOffset) % this.systemConfig.nodes.length
    }

    /**
     * The low-water mark is equal to the sequence number of the last stable checkpoint.
     * The high-water mark H = h + 2 * k, where is big enough so that replicas do 
     * not stall waiting for a checkpoint to become stable
     */

    lowWaterMark = 0

    get highWaterMark() {
        return this.lowWaterMark + this.systemConfig.params.k * 2
    }

    get lastStableSeq() {
        return this.lowWaterMark
    }

    /**
     * height is the number of requests committed
     * 
     *              <stable-ckpt=1>    <height=2>
     * |   ckpt 0     |   ckpt 1     |   ckpt 2     |    ckpt 3     | <- checkpoints
     * |l0|l1|l2|l3|c4|l5|l6|l7|l8|c9|l10|..|l12|c13|l14|nul|nul|nul| <-- logs
     * ^^^^^^^^^^^^^^^              ^                               ^
     * GC-able                  lowWaterMark                  highWaterMark
     * 
     * - lN means the Nth log, it can be any type of log
     * - cN means the Nth committed msg log
     * - l0~c4 has the same sequence number, and they are in the same checkpoint
     *   and so on for l5~c9, l10~c13...
     * - any log with seq number less than lowWaterMark, or lastStableSeq can be GC-ed
     * - height is 2 because c13 is the committed msg with index 2
     *   height is not 3 because its related request is not committed yet
     */
    _height = 0

    get height() {
        return this._height
    }

    set height(h: number) {
        this._height = h
        this.logger.debug('height changed to', h)
    }

    automata: Automata<TAutomataStatus>

    get master() {
        const index = this.view % this.systemConfig.nodes.length
        return this.systemConfig.nodes[index]
    }

    get isMaster() {
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

    // if true, the current node stops accepting messages 
    // other than checkpoint, view-change, and new-view messages
    viewChanging = false

    constructor(meta: NodeConfig, config: SystemConfig, automata: Automata<TAutomataStatus>) {
        this._seq = createSeqIterator()
        this.logger = new NamedLogger(meta.name)
        const derive = (name: string) => this.logger.derived(name)
        this.logs = new Logs(derive('log'), digestMsg)
        this.config = meta
        this.systemConfig = config
        this.automata = automata

        const enableSign = this.systemConfig.signature.enabled
        this.systemConfig.nodes.map((targetConfig) => {
            const networkClient = createNetworkClient(this.config, targetConfig, enableSign)
            this.nodes.set(targetConfig.name, networkClient)
        })
    }

    corrupt() {
        this.status = NodeStatus._Malicious
    }

    // gracefully close the node
    async close() {
        await this.closed.wait()
    }

    routes() {
        const wrapper = (routes: Routes): Routes => {
            return Object.fromEntries(Object.entries(routes).map(([key, handler]): [string, typeof handler] => {
                return [key, async (rawMsg) => {
                    const logger = this.logger.derived('routes/' + key)
                    logger.debug('recv', rawMsg)

                    let msg: Message
                    if (this.systemConfig.signature.enabled) {
                        const { signer, signature, data } = rawMsg as Partial<SignedObject<Message>>

                        if (!signature || !data) {
                            return createErrorMsg(ErrorCode.InvalidRequest)
                        }

                        msg = data as Message

                        const pubkey = [...this.systemConfig.nodes, ...this.systemConfig.clients].find(x => x.name === signer)?.pubkey
                        if (!pubkey) {
                            return createErrorMsg(ErrorCode.UnknownSender, `unknown sender ${signer}`)
                        }

                        const signValid = verify(pubkey, digestMsg(msg), signature)
                        if (!signValid) {
                            return createErrorMsg(ErrorCode.InvalidSignature)
                        }

                        // if msg has node field, it should be the same as signer
                        const { node } = msg as SourcedMessage
                        if (node && node !== signer) {
                            return createErrorMsg(ErrorCode.InvalidRequest)
                        }
                    } else {
                        msg = rawMsg as Message
                    }

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
                        const ret = error instanceof RemoteError ? createErrorMsg(error.code, error.message) : {
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

    checkpoint() {
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

        this.withTrace(this.boardcast(checkpointMsg)).catch((error) => {
            if (error instanceof TimeoutError) {
                logger.warn('checkpoint timeout, invoke view change')
                this.viewChange()
            }
        })
    }

    viewChange() {
        const logger = this.logger.derived('view-change')
        logger.debug('view change triggered')

        this.nextViewOffset++

        const newView = this.nextView
        logger.debug('attempt to change view, current view', this.view, 'new view', newView)

        const proof = this.logs.select(x => x.type === 'checkpoint' && x.sequence === this.lastStableSeq) as CheckpointMsg[]
        if (proof.length <= 2 * this.systemConfig.params.f) {
            logger.error('view change failed, not enough proof')
            return
        }

        const pendings = this.logs
            .select(x => x.type === 'pre-prepare' && x.sequence > this.lastStableSeq)
            .map((pp) => {
                assert(pp.type === 'pre-prepare')
                return {
                    prePrepareMsg: pp,
                    prepareMsgs: this.logs.select(p => p.type === 'prepare' && p.sequence === pp.sequence && p.digest === pp.digest) as PrepareMsg[],
                }
            })

        const viewChangeMsg: ViewChangeMsg = {
            type: 'view-change',
            view: newView,
            node: this.name,
            sequence: this.lastStableSeq,
            proof,
            pendings
        }

        this.withTrace(this.boardcast(viewChangeMsg)).catch((error) => {
            if (error instanceof TimeoutError) {
                logger.warn('view change timeout, head to next view')
                this.viewChange()
            }
        })
    }

    withTrace(promise: Promise<Message[]>) {
        this.closed.incr()
        return promise.then((rets) => {
            // prevent logging when the node is closed, same below
            this.logger.debug('boardcast reply', rets)
        }).catch((error) => {
            this.logger.error('boardcast error', error)
        }).finally(() => {
            this.closed.decr()
        })
    }

    _routes(): Routes {
        const domainRoutes: Routes = {
            'query-status': async () => {
                const msg: NodeStatusMsg<TAutomataStatus> = {
                    type: 'node-status',
                    view: this.view,
                    master: this.master.name,
                    automata: this.automata.status(),
                    params: this.systemConfig.params,
                    height: this.height,
                    lowWaterMark: this.lowWaterMark,
                    highWaterMark: this.highWaterMark,
                }
                return msg
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
                const logger = this.logger.derived('routes/request')
                const digest = digestMsg(msg)

                if (!this.isMaster) {
                    await this.forward(this.master.name, msg)
                    const committed = this.logs.last(
                        x => x.type === 'committed'
                            && x.digest === digest
                            && x.view == this.view
                    )
                    if (!committed) {
                        // means the master node is lagged or malicious or malicious
                        logger.warn('forwarded request not executed by master ' + this.master.name)
                        this.viewChange()
                        return {
                            type: 'error',
                            code: ErrorCode.ViewChanging,
                            message: 'view changing, please retry later',
                        }
                    }
                    const reply: ReplyMsg = {
                        type: 'reply',
                        view: this.view,
                        timestamp: msg.timestamp,
                        node: this.name,
                        result: 'forwarded',
                    }
                    return reply
                }

                await this.mutex.acquire()
                try {
                    requires(this.status === NodeStatus.Idle, ErrorCode.InvalidStatus, `status is ${this.status}, expect ${NodeStatus.Idle}`)
                    requires(!this.viewChanging, ErrorCode.ViewChanging, 'view changing, not available')
                    requires(this.seqValid(this.seq.peek()), ErrorCode.InvalidSequence)

                    const existing = (this.logs.first(
                        x => x.type === 'pre-prepare'
                            && x.view === this.view
                            && x.digest === digest
                    ) as Optional<PrePrepareMsg>)?.request

                    if (existing) {
                        const reply: ReplyMsg = {
                            type: 'reply',
                            view: this.view,
                            timestamp: msg.timestamp,
                            node: this.name,
                            result: 'already committed',
                        }

                        return reply
                    }

                    signal = createPromiseHandler<void>('request timeout', 30 * 1000)

                    const n = this.seq.next()
                    const prePrepareMsg: PrePrepareMsg = {
                        type: 'pre-prepare',
                        view: this.view,
                        sequence: n,
                        digest: digest,
                        request: msg,
                    }
                    this.withTrace(this.boardcast(prePrepareMsg)).catch((error) => {
                        if (error instanceof TimeoutError) {
                            logger.warn('pre-prepare timeout, invoke view change')
                            this.viewChange()
                        }
                    })

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

                    const reply: ReplyMsg = {
                        type: 'reply',
                        view: this.view,
                        timestamp: msg.timestamp,
                        node: this.name,
                        result: 'committed',
                    }

                    return reply
                } finally {
                    this.mutex.release()
                }
            },

            // a pre-prepare should be sent by master and receive only once
            'pre-prepare': async (msg: PrePrepareMsg) => {
                // const logger = this.logger.derived('routes/pre-prepare')

                requires(!this.viewChanging, ErrorCode.ViewChanging, 'view changing, not available')

                if (msg.digest === '' && msg.request.payload === '') {
                    return ok('null request, ignore')
                }

                // see the comments in routes/commit
                if (this.status !== NodeStatus.Idle) {
                    this.logger.warn(
                        `interesting, current node is lagged or malicious. status is ${this.status}, expect ${NodeStatus.Idle}. `
                        + 'but we will still append the pre-prepare message to logs')
                }

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
                    return ok('already committed, no need to pre-prepare')
                }

                if (this.logs.last(
                    x => x.type === 'prepare'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )) {
                    return ok('already prepared, no need to pre-prepare')
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

                this.withTrace(this.boardcast(prepareMsg))

                return ok('prepare boardcasting')
            },
            // prepare messages are sent by all pre-prepared nodes and will be received many times
            // when a PrepareMsg is received, the tx may have been prepared, and even committed locally (or not)
            'prepare': async (msg: PrepareMsg) => {
                const logger = this.logger.derived('routes/prepare')

                requires(!this.viewChanging, ErrorCode.ViewChanging, 'view changing, not available')
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
                requires((this.logs.first(
                    x => x.type === 'pre-prepare'
                        && x.sequence === msg.sequence
                        && x.digest === msg.digest
                ) as Optional<PrePrepareMsg>)?.request !== undefined, ErrorCode.InvalidStatus, 'no current request')
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
                    return ok('preparing')
                }

                if (this.logs.first(
                    x => x.type === 'prepared'
                        && x.node === this.name
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )) {
                    return ok('already prepared due to more than 2f prepare messages')
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

                requires(!this.viewChanging, ErrorCode.ViewChanging, 'view changing, not available')
                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)

                // prevent duplicated commit
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated commit message')

                const committed = this.logs.exists(
                    x => x.type === 'committed'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                        && x.node === this.name
                )
                if (committed) {
                    return ok('already committed due to more than 2f commit messages')
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
                    throw new RemoteError(ErrorCode.InvalidStatus, 'no related pre-prepare message found for commit message')
                }

                // edge case: the current node has received a pre-prepare message and is in the pre-prepared state.
                // however, other nodes have already switched to the prepared state and started broadcasting commit messages,
                // so the current node will directly receive commit messages in its pre-prepared state.
                // 
                // to handle this, we ignore the invalid status situation and just append the commit message to logs.
                // and when the 2f+1 commit messages are collected, the commit action will finally be executed.
                if (this.status !== NodeStatus.Prepared) {
                    logger.warn(
                        `interesting, current node is lagged or malicious. status is ${this.status}, expect ${NodeStatus.Prepared}. `
                        + 'but we will still append the commit message to logs')
                }

                requires(msg.view === this.view, ErrorCode.InvalidView)
                this.logs.append(msg)

                const count = this.logs.count(
                    x => x.type === 'commit'
                        && x.digest === msg.digest
                        && x.view == this.view
                        && x.sequence === msg.sequence
                )

                if (count <= 2 * this.systemConfig.params.f) {
                    return ok('committing')
                }

                logger.debug('collected enough commit messages')
                // mutate state
                const request = (this.logs.first(
                    x => x.type === 'pre-prepare'
                        && x.sequence === msg.sequence
                        && x.digest === msg.digest
                ) as Optional<PrePrepareMsg>)?.request

                if (!request) {
                    throw new RemoteError(ErrorCode.InternalError, 'a related request should exists')
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

                if (this.isMaster) {
                    assert(signal !== undefined)
                    logger.debug('master, signal request done')
                    signal.resolver()
                }
                this.status = NodeStatus.Idle

                this.logger.debug('onCommitted', msg)
                this.height++

                if (this.height % this.systemConfig.params.k === 0) {
                    this.checkpoint()
                }

                return {
                    message: 'committed'
                }
            }
        }

        const viewChangeRoutes: Routes = {
            // when a node received 2f+1 checkpoint messages with same seq and digest,
            // a stable checkpoint is reached, and it can safely discard all logs
            // of which the seq is less than that of the stable checkpoint
            'checkpoint': async (msg: CheckpointMsg) => {
                const logger = this.logger.derived('routes/checkpoint')

                requires(this.seqValid(msg.sequence), ErrorCode.InvalidSequence)
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated checkpoint message from same node')

                // the checkpoint messages are important
                // once 2f+1 ckpt msg is collected, we get a state validity proof
                this.logs.append(msg)

                const count = this.logs.count(
                    x => x.type === 'checkpoint' && x.sequence === msg.sequence && x.digest === msg.digest
                )

                logger.debug('count', count)
                if (count <= 2 * this.systemConfig.params.f) {
                    return ok('checkpointing')
                }

                logger.debug('stable checkpoint reached')
                this.lowWaterMark = msg.sequence

                logger.debug(`clear logs with seq < ${msg.sequence}`)
                this.logs.clear(x => x.sequence < msg.sequence)

                return ok('checkpoint created')
            },

            // the critical reason for view change is that the current master node is unable to reach consensus within a limited time
            // 
            // there are 4 cases:
            // 1. normal phase timeout, means the pre-prepare -> prepare -> commit cannot be completed within a certain time
            // 2. view-change phase timeout, means the current view change cannot be completed within a certain time
            // 3. the timer does not timeout, but the number of valid view-change messages reaches f+1,
            //   which means that there are already f+1 non-byzantine nodes initiating a new view change,
            //   and the current node enters the view change without waiting for timeout
            // 4. new-view message is invalid, which means that the master node in the view change phase is a byzantine node
            // 
            // view-change messages are sent by all nodes and only handled by new master node (msg.view % nodes.length === current node)
            'view-change': async (msg: ViewChangeMsg) => {
                const logger = this.logger.derived('routes/view-change')

                if (msg.view % this.systemConfig.nodes.length !== this.index) {
                    return ok('not my turn')
                }

                requires(msg.sequence === this.lastStableSeq, ErrorCode.InvalidSequence, `msg.sequence is ${msg.sequence}, expect ${this.lastStableSeq}`)
                requires(!this.logs.exists(msg), ErrorCode.DuplicatedMsg, 'duplicated view-change message')

                if (!this.viewChanging) {
                    logger.debug('enter view change state, stop accepting new requests')
                    this.viewChanging = true
                }

                this.logs.append(msg)

                // collect 2f+1 view-change messages
                const viewChangeMsgs = this.logs.select<ViewChangeMsg>(
                    x => x.type === 'view-change'
                        && x.view === msg.view
                        && x.sequence === msg.sequence
                )

                const count = viewChangeMsgs.length

                if (count <= 2 * this.systemConfig.params.f) {
                    return ok('view-changing')
                }

                logger.debug('collected enough view-change messages')

                const { minS, pendings } = this.inferPendingsFromProof(viewChangeMsgs, msg.view, logger)

                const newViewMsg: NewViewMsg = {
                    type: 'new-view',
                    view: msg.view,
                    sequence: msg.sequence,
                    proof: viewChangeMsgs,
                    pendings
                }

                this.logs.append(...newViewMsg.pendings)

                if (minS > this.lastStableSeq) {
                    logger.debug('current node is lagged or malicious, supply missing logs')
                    const ckpts = msg.proof
                    const newCkpts = ckpts.filter(x => this.lastStableSeq < x.sequence && x.sequence <= minS)
                    const lastCkpt = newCkpts.reduce((prev, curr) => {
                        return prev.sequence > curr.sequence ? prev : curr
                    })
                    this.logs.append(lastCkpt)

                    logger.debug('adjust lowWaterMark to', lastCkpt.sequence)
                    this.lowWaterMark = lastCkpt.sequence

                    logger.debug(`clear logs with seq < ${lastCkpt.sequence}`)
                    this.logs.clear(x => x.sequence < lastCkpt.sequence)

                    // when a node is lagged too much, seems the txs in the range (latestProof.sequence, minS] are lost
                    // a negotiation mechanism is needed to recover them, but it's not implemented here, osdi99 pbft
                }

                this.viewChanging = false
                this.nextViewOffset = 0
                this.view = msg.view
                this.seq.reset(minS)

                this.withTrace(this.boardcast(newViewMsg))

                return ok('new-view boardcasting')
            },
            'new-view': async (msg: NewViewMsg) => {
                const logger = this.logger.derived('routes/new-view')

                if (msg.view % this.systemConfig.nodes.length === this.index) {
                    return ok('master already switched to new view, ignore')
                }

                const { minS, pendings } = this.inferPendingsFromProof(msg.proof, msg.view, logger)

                // validate msg, pendings should be consistent with msg.pendings
                if (!deepEquals(pendings, msg.pendings)) {
                    logger.error('pendings are not consistent, the new master node may be malicious')
                    if (msg.view === this.nextView) {
                        this.nextViewOffset++ // avoid switching to the malicious view
                    }
                    this.viewChange()
                    throw new RemoteError(ErrorCode.InvalidStatus, 'pendings are not consistent, view changing')
                }

                this.viewChanging = true

                const newCkpts = msg.proof.filter(x => this.lastStableSeq < x.sequence && x.sequence <= minS)
                if (newCkpts.length === 0) {
                    logger.debug('no new checkpoints')
                } else {
                    logger.debug('supply missing logs')
                    const lastCkpt = newCkpts.reduce((prev, curr) => {
                        return prev.sequence > curr.sequence ? prev : curr
                    }, newCkpts[0])

                    this.logs.append(lastCkpt)

                    logger.debug('adjust lowWaterMark to', lastCkpt.sequence)
                    this.lowWaterMark = lastCkpt.sequence

                    logger.debug(`clear logs with seq < ${lastCkpt.sequence}`)
                    this.logs.clear(x => x.sequence < lastCkpt.sequence)
                }

                const oldView = this.view
                this.view = msg.view
                logger.debug('view changed from', oldView, 'to', this.view)

                this.viewChanging = false
                this.nextViewOffset = 0

                // execute the pending pre-prepare messages
                logger.debug('execute pendings', msg.pendings)

                for (const pp of msg.pendings) {
                    this.inject(pp)
                }
                logger.debug('execute pendings done')

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

    // i.e. the calculation of O in the paper
    inferPendingsFromProof(proof: ViewChangeMsg[], newView: number, logger?: Logger) {
        // minS is the latest stable checkpoint sequence number among all view-change messages
        const minS = Math.max(...proof.map(x => x.sequence))
        // maxS is the max sequence number among all pre-prepare messages in view-change messages, but the seq may not be stable
        const prepareSeqs = proof.map(x => x.pendings.flatMap(p => p.prePrepareMsg).map(p => p.sequence)).flat()
        const maxS = prepareSeqs.length > 0 ? Math.max(...prepareSeqs) : minS
        requires(minS <= maxS, ErrorCode.InternalError, `minS is ${minS}, maxS is ${maxS}`)

        // reconstruct pre-prepare messages for the requests (pre-prepare) in the range (minS, maxS]
        const pps = proof
            .flatMap(x => x.pendings)
            .flatMap(x => x.prePrepareMsg)
            .filter(x => x.sequence > minS && x.sequence <= maxS)

        let pendings: PrePrepareMsg[]
        if (pps.length > 0) {
            logger?.debug('reconstruct pre-prepare messages', pps)

            pendings = pps.map(pp => {
                return {
                    ...pp,
                    view: newView,
                }
            })
        } else {
            logger?.debug('no pre-prepare messages to reconstruct')

            const emptyPP: PrePrepareMsg = {
                type: 'pre-prepare',
                view: newView,
                sequence: minS,
                digest: '',
                request: {
                    type: 'request',
                    timestamp: 0,
                    payload: '',
                },
            }
            pendings = [emptyPP]
        }

        return {
            minS,
            maxS,
            pendings,
        }
    }

    async boardcast<T extends Message>(payload: T, timeout: number = 30 * 1000): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return withTimeout(multicast(nodes, payload), timeout, `boardcast timeout after ${timeout}ms, msg.type is ${payload.type} from ${this.name}`)
    }

    async forward<T extends Message>(node: string, payload: T, timeout: number = 30 * 1000): Promise<Message> {
        const sender = this.nodes.get(node)
        if (!sender) {
            throw new RemoteError(ErrorCode.InternalError, `node ${node} not found`)
        }
        return withTimeout(sender(payload), timeout, 'forward timeout')
    }

    /**
     * send a message to self
     */
    async inject<T extends Message>(msg: T) {
        const handler = this.routes()[msg.type]
        if (!handler) {
            throw new RemoteError(ErrorCode.InvalidType, `unknown msg type ${msg.type}`)
        }
        return handler(msg)
    }

    /**
     * check if the sequence number is valid between [h, H]
     */
    seqValid(seq: number) {
        if (!(this.lowWaterMark <= seq)) {
            this.logger.error('seq', seq, 'is less than lowWaterMark', this.lowWaterMark)
        }
        if (!(seq <= this.highWaterMark)) {
            this.logger.error('seq', seq, 'is greater than highWaterMark', this.highWaterMark)
        }
        return this.lowWaterMark <= seq && seq <= this.highWaterMark
    }
}
