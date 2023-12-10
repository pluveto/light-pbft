import { KVAutomataState } from '../automata'
import { Client } from '../client'
import { NodeStatusMsg, QueryStatusMsg } from '../message'
import { serve } from '../serve'
import { createSingleNodeConfig } from './util'

describe('Single Node', () => {
    jest.setTimeout(10000)

    let client: Client
    let server: Awaited<ReturnType<typeof serve>>

    beforeEach(async () => {
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
            const task = client.send({
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            })
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

        const query: QueryStatusMsg = {
            type: 'query-status',
        }
        const status = (await client.send(query)) as NodeStatusMsg<KVAutomataState>
        console.log(status)
    })
})
