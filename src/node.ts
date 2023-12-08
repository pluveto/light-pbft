import jaysom from 'jayson/promise'

import { Registry } from './registry'
import { boardcast, createSeqIterator, sha256 } from './util'
import { CommitMsg, ErrorCode, ErrorMsg, MasterInfoMsg, Message, PrePrepareMsg, PrepareMsg, RequestMsg } from './message'
import { NodeConfig, SystemConfig } from './config'
import { Automata } from './automata'
import { NamedLogger } from './logger'
import assert from 'assert'

function calcMaster(view: number, nodes: NodeConfig[]) {
    const masterIndex = view % nodes.length
    return nodes[masterIndex]
}

function createMsgDigest<T extends Message>(msg: T) {
    return sha256(JSON.stringify(msg))
}

function createPromise<T>(timeout: number = 3000) {
    let resolver
    const promise = new Promise<T>((resolve, reject) => {
        resolver = resolve
        if (timeout > 0) {
            setTimeout(() => {
                reject(new Error('timeout'))
            }, timeout)
        }
    })
    return {
        promise,
        resolver: resolver!
    }
}

export enum NodeStatus {
    Idle = 'idle',
    Prepare = 'prepare',
    Commit = 'commit',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<T extends Message> = (msg: T) => Promise<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Routes = { [key: string]: RouteHandler<any> };

export class Node<TStatus> {
    // address -> connection
    config: NodeConfig
    logger: NamedLogger
    nodes: Map<string, jaysom.client> = new Map() // name -> client
    view: number = 0
    registry!: Registry
    systemConfig: SystemConfig
    seq = createSeqIterator()
    status: NodeStatus = NodeStatus.Idle
    params = {
        f: 1, // max fault node count
    }
    requestQueue: RequestMsg[] = []
    current?: {
        request: RequestMsg
        promise: Promise<void>
        resolver: () => void
    }
    preparing?: {
        digest: string
        msg: PrepareMsg
        count: number
        prepared: boolean
        promise: Promise<void>
        resolver: () => void
    }

    commiting?: {
        digest: string
        msg: CommitMsg
        count: number
        committed: boolean // committed locally
        promise: Promise<void>
        resolver: () => void
    }

    automata: Automata<TStatus>

    constructor(meta: NodeConfig, config: SystemConfig, automata: Automata<TStatus>) {
        this.logger = new NamedLogger(meta.name)
        this.config = meta
        this.systemConfig = config
        this.automata = automata
        this.params = config.params

        this.systemConfig.nodes.map((node) => {
            const client = jaysom.client.http({
                host: node.host,
                port: node.port,
            })
            this.nodes.set(node.name, client)
        })
    }

    getMaster() {
        return calcMaster(this.view, this.systemConfig.nodes)
    }

    routes() {
        const wrapper = (routes: Routes): Routes => {
            return Object.fromEntries(Object.entries(routes).map(([key, handler]): [string, typeof handler] => {
                return [key, async (msg) => {
                    const logger = this.logger.derived(key)
                    logger.info('recv', msg)
                    try {
                        const ret = await handler(msg)
                        logger.info('resp', ret)
                        return ret
                    } catch (error) {
                        const emsg: ErrorMsg = {
                            type: 'error',
                            code: ErrorCode.UNKNOWN,
                            message: (error as Error).message,
                        }
                        logger.error(error)
                        return emsg
                    }
                }]
            }))
        }

        return wrapper(this._routes())
    }

    _routes(): Routes {
        return {
            'query-status': async () => {
                return {
                    status: 'ok',
                    view: this.view,
                    master: this.getMaster().name,
                    automata: this.automata.status(),
                    params: this.params,
                }
            },
            'find-master': async () => {
                const ret: MasterInfoMsg = {
                    type: 'master-info',
                    master_name: this.getMaster().name,
                }
                return ret
            },
            'pre-prepare': async (msg: PrePrepareMsg) => {
                const logger = this.logger.derived('pre-prepare')
                // todo: validate signatures of m and pre-prepare msg
                if (msg.view !== this.view) {
                    throw new Error('mismatch view')
                }

                const digest = await createMsgDigest(msg.request)
                if (digest !== msg.digest) {
                    throw new Error('mismatch digest')
                }

                this.status = NodeStatus.Prepare
                const prepareMsg: PrepareMsg = {
                    type: 'prepare',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                }
                this.preparing = {
                    digest: msg.digest,
                    msg: prepareMsg,
                    count: 0,
                    prepared: false,
                    ...createPromise<void>(),
                }
                logger.info('boardcast', (prepareMsg))
                const ret = await this.boardcast(prepareMsg)
                logger.info('ret', ret)
                await this.preparing.promise
                logger.info('prepared')
                this.preparing = undefined
            },
            'prepare': async (msg: PrepareMsg) => {
                const logger = this.logger.derived('prepare')
                if (!this.preparing) {
                    throw new Error('no preparing')
                }

                assert(this.status === NodeStatus.Prepare)
                if (msg.view !== this.view) {
                    throw new Error('mismatch view')
                }

                if (msg.digest !== this.preparing.digest) {
                    throw new Error('mismatch digest')
                }

                this.preparing.count++
                logger.info('count', this.preparing.count)
                if (this.preparing.count <= 2 * this.params.f) {

                    return {
                        message: 'preparing'
                    }
                }
                this.preparing.prepared = true
                this.preparing.resolver()
                this.status = NodeStatus.Commit
                logger.info('prepared', this.preparing.msg)
                const commitMsg: CommitMsg = {
                    type: 'commit',
                    view: this.view,
                    sequence: msg.sequence,
                    digest: msg.digest,
                }
                this.commiting = {
                    digest: msg.digest,
                    msg: commitMsg,
                    count: 0,
                    committed: false,
                    ...createPromise<void>(),
                }
                logger.info('boardcast', (commitMsg))
                const ret = await this.boardcast(commitMsg)
                logger.info('ret', ret)
                await this.commiting.promise
                logger.info('notice committed')
                this.commiting = undefined
                return {
                    message: 'prepared, committed'
                }
            },
            'commit': async (msg: CommitMsg) => {
                const logger = this.logger.derived('commit')
                if (!this.commiting) {
                    throw new Error('no commiting')
                }
                if (!this.current) {
                    throw new Error('no reqMsg set')
                }
                // 1. validate signatures of m and commit msg
                // 2. validate view
                if (msg.view !== this.view) {
                    throw new Error('mismatch view')
                }
                // 3. validate sequence
                if (!this.isValidSeq(msg.sequence)) {
                    throw new Error('invalid sequence')
                }

                // 4. validate digest
                if (this.commiting?.digest !== msg.digest) {
                    throw new Error('mismatch digest')
                }

                this.commiting.count++
                logger.info('count', this.commiting.count)
                if (this.commiting.count <= 2 * this.params.f) {

                    return {
                        message: 'commiting'
                    }
                }

                logger.info('commiting')
                await this.automata.transfer(this.current?.request.payload)
                logger.info('committed', this.current)
                this.commiting.committed = true
                this.commiting.resolver()
                logger.info('to reset')

                return {
                    message: 'committed'
                }
            },
            'request': async (msg: RequestMsg) => {
                if (this.current) {
                    await this.current.promise
                }
                this.current = {
                    request: msg,
                    ...createPromise<void>(),
                }
                const n = this.seq.next()
                const logger = this.logger.derived('request')
                const prePrepareMsg: PrePrepareMsg = {
                    type: 'pre-prepare',
                    view: this.view,
                    sequence: n,
                    digest: await createMsgDigest(msg),
                    request: msg,
                }
                logger.info('boardcast', (prePrepareMsg))
                const ret = await this.boardcast(prePrepareMsg)
                this.logger.derived('request').info('ret', ret)
                return {
                    message: 'ok'
                }
            }
        }
    }
    async boardcast<T extends Message>(payload: T): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return boardcast(nodes, payload)
    }

    async isValidSeq(seq: number) {
        return 0 < seq && seq <= this.seq.peek()
    }
}
