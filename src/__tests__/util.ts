import { SystemConfig } from '../config'
import net from 'net'
import { genKeyPair } from '../util'

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
        nodes: [
            {
                name: name,
                host: 'localhost',
                port: await findPort(),
                ...genKeyPair(),
            }
        ],
        params: {
            f: 0
        }
    }
}

export async function createClusterConfig(size: number = 4): Promise<SystemConfig> {
    const nodes = []
    for (let i = 0; i < size; i++) {
        nodes.push({
            name: `node${i}`,
            host: 'localhost',
            port: await findPort(),
            ...genKeyPair(),
        })
    }
    return {
        nodes,
        params: {
            f: (size - 1) / 3
        }
    }
}
