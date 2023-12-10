import crypto from 'crypto'
import jayson from 'jayson/promise'

import { Message, RemoteError } from './message'
import { SenderConfig, NodeConfig } from './config'
import { sign } from './sign'

export function sha256(data: string): string {
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return hash.digest('hex')
}

export function quote(s: string) {
    s = s.replace(/\\/g, '\\\\')
    s = s.replace(/"/g, '\\"')
    return `"${s}"`
}

export type SeqIterator = ReturnType<typeof createSeqIterator>

export function createSeqIterator(max: number = Infinity) {
    let i = 0
    return {
        next() {
            i = (i + 1) % max
            return i
        },
        peek() {
            return i
        },
        reset(val: number = 0) {
            i = val
        }
    }
}

export type NetworkClient = (msg: Message) => Promise<Message>

export type SignedObject<T> = {
    signer: string
    signature: string
    data: T
}

export function createNetworkClient(source: SenderConfig, target: NodeConfig, enableSign: boolean): NetworkClient {
    const client = jayson.client.http({
        host: target.host,
        port: target.port,
        timeout: 3 * 60 * 1000,
    })

    client.on('http error', (err: Error) => {
        console.warn('http error')
        console.error(err)
    })

    if (!enableSign) {
        return async (msg: Message) => {
            const res = await client.request(msg.type, msg)
            if (res.error) {
                throw new RemoteError(res.error.code, res.error.message)
            }
            return res.result
        }
    }

    return async (msg: Message) => {
        // sign the message before sending
        const signedMsg: SignedObject<Message> = {
            signer: source.name,
            signature: sign(source.prikey, digestMsg(msg)),
            data: msg,
        }
        const res = await client.request(msg.type, signedMsg)
        if (res.error) {
            throw new RemoteError(res.error.code, res.error.message)
        }
        return res.result
    }
}

export async function multicast<T extends Message>(senders: NetworkClient[], payload: T): Promise<Message[]> {
    return await Promise.all(senders.map(sender => sender(payload)))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function deepEquals(a: any, b: any) {
    if (a === b) return true

    if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) {
        return false
    }

    const keysA = Object.keys(a)
    const keysB = Object.keys(b)

    if (keysA.length !== keysB.length) return false

    for (const key of keysA) {
        if (!keysB.includes(key)) return false
        if (!deepEquals(a[key], b[key])) return false
    }

    return true
}

export class TimeoutError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'TimeoutError'
    }
}

export function withTimeout<T>(promise: Promise<T>, timeout: number, message?: string | Error): Promise<T> {
    if (timeout === Infinity || timeout <= 0) {
        return promise
    }
    return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            if (typeof message === 'string' || message === undefined) {
                message = message ?? `timeout after ${timeout}ms`
                reject(new TimeoutError(message))
            } else {
                reject(message)
            }
        }, timeout)

        promise.then(
            (value) => {
                clearTimeout(timeoutHandle)
                resolve(value)
            },
            (reason) => {
                clearTimeout(timeoutHandle)
                reject(reason)
            }
        )
    })
}


export function digestMsg<T extends Message>(msg: T) {
    return sha256(JSON.stringify(msg))
}

export function createPromiseHandler<T>(timeoutMessage?: string, timeout: number = 30 * 1000) {
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
                    reject(new Error(timeoutMessage ?? 'timeout'))
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

export async function createElementsAsync<T>(size: number, fn: (index: number) => Promise<T>) {
    const operations = Array.from({ length: size }, async (_, index) => {
        const item = await fn(index)
        return item
    })
    return await Promise.all(operations)
}
