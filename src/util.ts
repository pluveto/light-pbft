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
export async function sha256(data: string): Promise<string> {
    const hash = crypto.createHash('sha256')
    hash.update(data)
    return hash.digest('hex')
}

export function quote(s: string) {
    s = s.replace(/\\/g, '\\\\')
    s = s.replace(/"/g, '\\"')
    return `"${s}"`
}

export function createSeqIterator(max: number = Infinity) {
    let i = 0
    return {
        next() {
            i = i++ % max
            return i
        },
        peek() {
            return i
        }
    }
}
export async function boardcast<T extends Message>(clients: jaysom.HttpClient[], payload: T): Promise<Message[]> {
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
