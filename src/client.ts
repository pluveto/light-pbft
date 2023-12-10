import { NodeConfig } from './config'
import jaysom from 'jayson/promise'
import { ErrorCode, ErrorMsg, FindMasterMsg, MasterInfoMsg, Message, RemoteError, ReplyMsg, RequestMsg } from './message'
import { multicast, withTimeout } from './util'
import { retry } from './retry'
import { Optional } from './types'

export class MultiError extends Error {
    errors: Error[]

    constructor(message: string, errors: Error[]) {
        super(message)
        this.errors = errors
    }
}

export class Client {
    private nodes: Map<string, jaysom.client> = new Map()
    master?: string

    constructor(nodes: NodeConfig[]) {
        nodes.map((node) => {
            const client = jaysom.client.http({
                host: node.host,
                port: node.port,
            })
            this.nodes.set(node.name, client)
        })
    }

    /**
     * send a message to master node
     */
    async send<T extends Message>(msg: T, timeout: number = 3000): Promise<Message> {
        if (!this.master) {
            throw new Error('master not set')
        }
        const sendPromise = this.nodes.get(this.master)!.request(msg.type, msg)
        return (await withTimeout(sendPromise, timeout)).result
    }

    /**
     * send a message to all nodes and succeed if more than f same responses are received
     */

    async request(msg: RequestMsg, timeout: number = 3000): Promise<ReplyMsg> {
        return retry(async () => {
            return this._request(msg, timeout)
        }, {
            maxAttempts: 3,
            initialDelay: 1000,
            backoffMultiplier: 2,
            filter: (err) => {
                if (err instanceof RemoteError && err.code === ErrorCode.ViewChanging) {
                    return true // only retry for view changing
                }
                return false
            }
        })
    }

    async _request(msg: RequestMsg, timeout: number = 3000): Promise<ReplyMsg> {
        if (!this.master) {
            throw new Error('master not set')
        }

        const rets = await this.boardcast(msg, timeout)
        console.log(rets)

        const f = Math.floor((rets.length - 1) / 3)
        const majorType = findMajority2(rets.map(x => x.type), f)
        const major = rets.filter(x => x.type === majorType) as ReplyMsg[]
        if (!majorType) {
            throw new MultiError('no majority type', rets.map((x, i) => new Error(`[${i}] ${x.type}`)))
        }

        if (majorType === 'error') {
            const errors = rets.filter(x => x.type === 'error').map(x => x as ErrorMsg)
            const majorErrorCode = findMajority2(errors.map(x => x.code), f)
            if (!majorErrorCode) {
                throw new MultiError(
                    'no majority error code', errors.map((x, i) => new Error(`[${i}] ${x.code}`))
                )
            }
            if (majorErrorCode === ErrorCode.ViewChanging) {
                throw new RemoteError(ErrorCode.ViewChanging, 'view changing')
            }

            throw new MultiError(
                'error response', errors.map(x => new RemoteError(x.code, x.message))
            )
        }

        if (majorType !== 'reply') {
            throw new MultiError(
                'no reply response', rets.map((x, i) => new Error(`[${i}] ${x.type}`))
            )
        }

        const replies = major as ReplyMsg[]
        // all reply must be the same
        if (replies.length === 0) {
            throw new MultiError(
                'no reply response', rets.map((x, i) => new Error(`[${i}] ${x.type} != reply`))
            )
        }

        const reply = replies[0]
        const consistent = replies.every(
            x => x.timestamp === reply.timestamp
                && x.view === reply.view
        )

        if (!consistent) {
            throw new MultiError(
                'inconsistent reply response',
                replies.map((x, i) => new Error(`[${i}] timestamp: ${x.timestamp}, view: ${x.view}`))
            )
        }

        return reply
    }

    /**
     * boardcast a message to all nodes
     */
    async boardcast<T extends Message>(payload: T, timeout: number = Infinity): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return (await withTimeout(multicast(nodes, payload), timeout))
    }

    async findMaster() {
        const msg: FindMasterMsg = {
            type: 'find-master',
        }
        const ret = await this.boardcast(msg) as MasterInfoMsg[]
        const master = findMajority(ret.map(x => x.name))
        return master
    }
}

/**
 * Find the BFT major element in an array, which is the element that appears more than 2/3 times.
 * 
 * @param arr array of elements
 * @returns the major element if exists, undefined otherwise
 */
export function findMajority<T>(arr: T[]): Optional<T> {
    const thold = Math.floor(arr.length * 2 / 3)

    const counter = new Map<string, number>()
    for (const x of arr) {
        const encoded = JSON.stringify(x)
        const count = counter.get(encoded) || 0
        counter.set(encoded, count + 1)
    }
    for (const [x, count] of counter) {
        if (count > thold) {
            return JSON.parse(x)
        }
    }
    return undefined
}

export function findMajority2<T>(arr: T[], f: number): Optional<T> {
    const thold = f

    const counter = new Map<string, number>()
    for (const x of arr) {
        const encoded = JSON.stringify(x)
        const count = counter.get(encoded) || 0
        counter.set(encoded, count + 1)
    }
    for (const [x, count] of counter) {
        if (count > thold) {
            return JSON.parse(x)
        }
    }
    return undefined
}


