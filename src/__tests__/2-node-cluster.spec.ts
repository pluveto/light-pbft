import { Client } from '../client'
import { serve } from '../serve'
import { createClusterConfig } from './util'

describe('2 Nodes Cluster where f = 0', () => {
    jest.setTimeout(30 * 1000)

    let client: Client
    let servers: Array<Awaited<ReturnType<typeof serve>>>

    beforeEach(async () => {
        const systemConfig = await createClusterConfig({ size: 2 })
        expect(systemConfig.params.f).toBe(0)
        servers = await Promise.all(systemConfig.nodes.map((node) => serve(node.name, systemConfig)))
        client = new Client(systemConfig.clients[0], systemConfig.nodes, systemConfig.signature.enabled)
    })

    afterEach(async () => {
        await Promise.all(servers.map((server) => server.close()))
    })

    it('should be able to start', async () => {
        expect(true).toBe(true)
    })

    it('should be able to handle request', async () => {
        const ret = await client.request({
            type: 'request',
            timestamp: Date.now(),
            payload: 'key1:value1',
        })
        expect(ret.type).toBe('reply')

        const status = await client.send({
            type: 'query-automata',
            command: 'key1',
        })

        expect(status).toMatchObject({
            type: 'ok',
            message: 'value1',
        })
    })

    it('should be able to handle a batch of requests one by one', async () => {
        const N = 10
        const tasks = []
        for (let i = 0; i < N; i++) {
            const task = client.request({
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            }, 30 * 1000)
            tasks.push(task)
        }
        const rets = await Promise.all(tasks)

        expect(rets.every((ret) => ret.type === 'reply')).toBe(true)

        for (let i = 0; i < N; i++) {
            const status = await client.send({
                type: 'query-automata',
                command: `key${i}`,
            })
            expect(status).toMatchObject({
                type: 'ok',
                message: `value${i}`,
            })
        }
    })
})
