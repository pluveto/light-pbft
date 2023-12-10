import { SystemConfig } from '../config'
import net from 'net'
import { genKeyPair } from '../sign'
import { createElementsAsync } from '../util'

export async function findPort(): Promise<number> {
    const nextPort = () => Math.floor(Math.random() * 10000) + 10000
    const maxTries = 100
    const portIsOccupied = (port: number) => {
        const tester = net.createServer()
        return new Promise((resolve) => {
            tester.once('error', () => {
                resolve(true)
            })
            tester.once('listening', () => {
                tester.close()
                resolve(false)
            })
            tester.listen(port)
        })
    }
    for (let i = 0; i < maxTries; i++) {
        const port = nextPort()
        if (await portIsOccupied(port)) {
            continue
        }
        return port
    }

    throw new Error('no available port')
}

export async function createSingleNodeConfig(name: string = 'node'): Promise<SystemConfig> {
    return {
        signature: {
            enabled: false
        },
        nodes: [
            {
                name: name,
                host: '127.0.0.1',
                port: await findPort(),
                ...genKeyPair(),
            }
        ],
        clients: [
            {
                name: 'client',
                ...genKeyPair(),
            }
        ],
        params: {
            f: 0,
            k: 5,
        }
    }
}

type CreateClusterConfigOptions = {
    size?: number
    k?: number
}

export async function createClusterConfig({
    size = 4,
    k = 30,
}: CreateClusterConfigOptions): Promise<SystemConfig> {
    const f = Math.floor((size - 1) / 3)
    return {
        signature: {
            enabled: false
        },
        nodes: await createElementsAsync(size,
            async i => ({
                name: `node${i}`,
                host: '127.0.0.1',
                port: await findPort(),
                ...genKeyPair(),
            })
        ),
        clients: await createElementsAsync(size,
            async i => ({
                name: `client${i}`,
                host: '127.0.0.1',
                port: await findPort(),
                ...genKeyPair(),
            })
        ),
        params: {
            f,
            k
        }
    }
}
