import jaysom from 'jayson/promise'

import { Registry } from './registry'
import { boardcast, createSeqIterator, sha256 } from './util'
import { CommitMsg, MasterInfoMsg, Message, PrePrepareMsg, PrepareMsg, RequestMsg } from './message'
import { NodeConfig, SystemConfig } from './config'
import { Automata } from './automata'

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

export class Node<TAutomata> {
    // address -> connection
    meta: NodeConfig
    nodes: Map<string, jaysom.client> = new Map() // name -> client
    view: number = 0
    registry!: Registry
    config: SystemConfig
    seq = createSeqIterator()
    status: NodeStatus = NodeStatus.Idle
    params = {
        f: 1, // max fault node count
    }

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
    }

    automata: Automata<TAutomata>

    constructor(meta: NodeConfig, config: SystemConfig, automata: Automata<TAutomata>) {
        this.meta = meta
        this.config = config
        this.automata = automata

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

    router() {
        return {
            'query-status': async () => {
                return {
                    status: 'ok',
                    view: this.view,
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
            },
            'prepare': async (msg: PrepareMsg) => {
                if (!this.preparing) {
                    throw new Error('no preparing')
                }
                console.assert(this.status === NodeStatus.Prepare)
                if (msg.view !== this.view) {
                    throw new Error('mismatch view')
                }
                if (msg.digest !== this.preparing.digest) {
                    throw new Error('mismatch digest')
                }
                this.preparing.count++
                if (this.preparing.count >= 2 * this.params.f) {
                    this.preparing.prepared = true
                    this.status = NodeStatus.Commit

                    const commitMsg: CommitMsg = {
                        type: 'commit',
                        view: this.view,
                        sequence: msg.sequence,
                        digest: msg.digest,
                    }

                    const ret = await this.boardcast(commitMsg)
                }
            },
            'commit': async (msg: CommitMsg) => {
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

                if (this.commiting.count >= 2 * this.params.f) {
                    this.commiting.committed = true
                    this.status = NodeStatus.Idle
                    this.view++
                    this.commiting = undefined
                    this.preparing = undefined
                }
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
                const ret = await this.boardcast(prePrepareMsg)
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
