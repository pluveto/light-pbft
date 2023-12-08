import { Client } from '../client'
import { serve } from '../serve'
import { createSingleNodeConfig } from './util'

describe('Single Node', () => {
    let client: Client
    let server: Awaited<ReturnType<typeof serve>>

    beforeEach(async () => {
        jest.setTimeout(10000)
        const cfg = await createSingleNodeConfig('node')
        server = await serve('node', cfg)
        client = new Client(cfg.nodes)
        client.master = 'node'
    })

    afterEach(async () => {
        await server.close()
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
