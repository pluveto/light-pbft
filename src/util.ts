import * as net from 'net'
import jaysom from 'jayson/promise'
import crypto from 'crypto'
import { Message } from './message'
import * as elliptic from 'elliptic'
const ec = new elliptic.ec('secp256k1')

export function getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.on('error', reject)
        server.listen(0, () => {
            const addr = server.address()
            if (typeof addr === 'string') {
                throw new Error('Unexpected string address')
            }
            if (addr === null) {
                throw new Error('Unexpected null address')
            }
            const port = addr.port
            server.close(() => {
                resolve(port)
            })
        })
    })
}
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

export async function multicast<T extends Message>(clients: jaysom.HttpClient[], payload: T): Promise<Message[]> {
    const reqs = clients.map((node) => node.request(payload.type, payload))
    const ret = await Promise.all(reqs)
    return ret.map((r) => r.result)
}


export function genKeyPair() {
    const keyPair = ec.genKeyPair()
    return {
        prikey: keyPair.getPrivate('hex'),
        pubkey: keyPair.getPublic('hex')
    }
}

export function sleep(ms: number) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms)
    })
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

export function withTimeout<T>(promise: Promise<T>, timeout: number, message: string | Error = 'timed out'): Promise<T> {
    if (timeout === Infinity || timeout <= 0) {
        return promise
    }
    return new Promise((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
            if (typeof message === 'string') {
                reject(new Error(message))
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

export function createPromiseHandler<T>(timeoutMessage?: string, timeout: number = 3000) {
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
