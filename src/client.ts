import { NodeConfig, SenderConfig } from './config'
import {
    ClientMessage,
    ErrorCode,
    ErrorMsg,
    Message,
    RemoteError,
    ReplyMsg,
} from './message'
import {
    NetworkClient,
    createNetworkClient,
    multicast,
    withTimeout
} from './util'
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
    private nodes: Map<string, NetworkClient>

    constructor(config: SenderConfig, nodes: NodeConfig[], enableSign: boolean) {
        this.nodes = new Map(nodes.map((node) => {
            const sender = createNetworkClient(config, node, enableSign)
            return [node.name, sender]
        }))
    }

    /**
     * send a mutation to all nodes and succeed if more than f same responses are received
     */
    async request(msg: ClientMessage, timeout: number = 30 * 1000): Promise<ReplyMsg> {
        return retry(async () => {
            try {
                return this._request(msg, timeout)
            } catch (error) {
                console.log(error)
                throw error
            }
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

    async _request(msg: ClientMessage, timeout: number = 30 * 1000): Promise<ReplyMsg> {
        const rets = await this.boardcast(msg, timeout)
        console.log(rets)

        const f = Math.floor((rets.length - 1) / 3)
        const majorType = findMajority(rets.map(x => x.type), f)
        const major = rets.filter(x => x.type === majorType) as ReplyMsg[]
        if (!majorType) {
            throw new MultiError('no majority type', rets.map((x, i) => new Error(`[${i}] ${x.type}`)))
        }

        if (majorType === 'error') {
            const errors = rets.filter(x => x.type === 'error').map(x => x as ErrorMsg)
            const majorErrorCode = findMajority(errors.map(x => x.code), f)
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
    async boardcast<T extends Message>(msg: T, timeout: number = Infinity): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return (await withTimeout(multicast(nodes, msg), timeout))
    }

    /**
     * send a message to all nodes and return the majority response
     */
    async send<T extends Message>(msg: T, timeout: number = Infinity): Promise<Optional<Message>> {
        const ret = await this.boardcast(msg, timeout)
        return findMajority(ret)
    }
}

/**
 * Find the BFT major element in an array, which is the element that appears more than f times.
 * 
 * @param arr array of elements
 * @returns the major element if exists, undefined otherwise
 */
export function findMajority<T>(arr: T[], f?: number): Optional<T> {
    if (!f) {
        f = Math.floor((arr.length - 1) / 3)
    }
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


