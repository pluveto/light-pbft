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
    meta: NodeConfig
    logger: NamedLogger
    nodes: Map<string, jaysom.client> = new Map() // name -> client
    view: number = 0
    registry!: Registry
    config: SystemConfig
    seq = createSeqIterator()
    status: NodeStatus = NodeStatus.Idle
    params = {
        f: 1, // max fault node count
    }
    reqMsg?: RequestMsg
    preparing?: {
        digest: string
        msg: PrepareMsg
        count: number
        prepared: boolean
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
        this.meta = meta
        this.config = config
        this.automata = automata
        this.params = config.params

        this.config.nodes.map((node) => {
            const client = jaysom.client.http({
                host: node.host,
                port: node.port,
            })
            this.nodes.set(node.name, client)
        })
    }

    getMaster() {
        return calcMaster(this.view, this.config.nodes)
    }

    reset() {
        this.status = NodeStatus.Idle
        this.preparing = undefined
        this.commiting = undefined
        this.reqMsg = undefined
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
                }
                const ret = await this.boardcast(prepareMsg)
                logger.info('ret', ret)
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
                if (this.preparing.count > 2 * this.params.f) {
                    this.preparing.prepared = true
                    this.status = NodeStatus.Commit
                    logger.info('prepared', this.preparing.msg)
                    const commitMsg: CommitMsg = {
                        type: 'commit',
                        view: this.view,
                        sequence: msg.sequence,
                        digest: msg.digest,
                    }
                    let resolver
                    const promise = new Promise<void>((resolve, reject) => {
                        resolver = resolve
                        setTimeout(() => {
                            reject(new Error('timeout'))
                        }, 1000)
                    })
                    this.commiting = {
                        digest: msg.digest,
                        msg: commitMsg,
                        count: 0,
                        committed: false,
                        promise,
                        resolver: resolver!
                    }
                    const ret = await this.boardcast(commitMsg)
                    logger.info('ret', ret)
                    await this.commiting.promise
                    logger.info('notice committed, reset')
                    this.reset()
                }
                return {}
            },
            'commit': async (msg: CommitMsg) => {
                const logger = this.logger.derived('commit')
                if (!this.commiting) {
                    throw new Error('no commiting')
                }
                if (!this.reqMsg) {
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
                if (this.commiting.count > 2 * this.params.f) {
                    logger.info('commiting')
                    await this.automata.transfer(this.reqMsg?.payload)
                    logger.info('committed', this.reqMsg)
                    this.commiting.committed = true
                    this.commiting.resolver()
                    logger.info('to reset')
                }

                return {}
            },
            'request': async (msg: RequestMsg) => {
                const n = this.seq.next()
                const prePrepareMsg: PrePrepareMsg = {
                    type: 'pre-prepare',
                    view: this.view,
                    sequence: n,
                    digest: await createMsgDigest(msg),
                    request: msg,
                }
                this.reqMsg = msg
                const ret = await this.boardcast(prePrepareMsg)
                this.logger.derived('request').info('ret', ret)
                return {}
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
