import { Client } from '../client'
import { serve } from '../serve'
import { createClusterConfig } from './util'

describe('2 Nodes Cluster where f = 0', () => {
    jest.setTimeout(10000)

    let client: Client
    let servers: Array<Awaited<ReturnType<typeof serve>>>

    beforeEach(async () => {
        const cfg = await createClusterConfig(2)
        expect(cfg.params.f).toBe(0)
        servers = await Promise.all(cfg.nodes.map((node) => serve(node.name, cfg)))
        client = new Client(cfg.nodes)
        client.master = await client.findMaster()
        expect(client.master).toBe(servers[0].node.name)
    })

    afterEach(async () => {
        await Promise.all(servers.map((server) => server.close()))
    })

    it('should be able to start', async () => {
        expect(true).toBe(true)
    })

    it('should be able to handle request', async () => {
        const ret = await client.send({
            type: 'request',
            timestamp: Date.now(),
            payload: 'key1:value1',
        })
        expect(ret).toMatchObject({
            type: 'ok',
        })

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
            const task = client.send({
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            })
            tasks.push(task)
        }
        const rets = await Promise.all(tasks)

        expect(rets).toEqual(Array(N).fill({
            type: 'ok',
        }))

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
