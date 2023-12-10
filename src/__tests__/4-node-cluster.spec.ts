import { KVAutomataState } from '../automata'
import { Client } from '../client'
import { SystemConfig } from '../config'
import { NodeStatusMsg, QueryStatusMsg, RequestMsg } from '../message'
import { serve } from '../serve'
import { createClusterConfig } from './util'

describe('4 Nodes Cluster where f = 1', () => {
    jest.setTimeout(10000)

    let client: Client
    let servers: Array<Awaited<ReturnType<typeof serve>>>
    let systemConfig: SystemConfig

    beforeEach(async () => {
        systemConfig = await createClusterConfig({ size: 4, k: 2 })
        expect(systemConfig.params.f).toBe(1)
        servers = await Promise.all(systemConfig.nodes.map((node) => serve(node.name, systemConfig)))
        client = new Client(systemConfig.nodes)
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

    it('should have consistent state machine digest on difference nodes', async () => {
        for (let i = 0; i < 2; i++) {
            const req: RequestMsg = {
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            }
            const ret = await client.send(req)
            expect(ret.type).toBe('reply')
        }

        const query: QueryStatusMsg = {
            type: 'query-status',
        }
        const status = (await client.boardcast(query)) as NodeStatusMsg<KVAutomataState>[]
        console.log(status)
        expect(status).toHaveLength(4)

        const digests = status.map((item) => item.automata.digest)
        expect([...new Set(digests)]).toHaveLength(1)
    })

    it('should be able to handle a batch of requests one by one', async () => {
        const numRequest = 2
        const tasks = []
        for (let i = 0; i < numRequest; i++) {
            const task = client.send({
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            })
            tasks.push(task)
        }
        const rets = await Promise.all(tasks)

        expect(rets.every((ret) => ret.type === 'reply')).toBe(true)

        for (let i = 0; i < numRequest; i++) {
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

        const status = (await client.boardcast(query)) as NodeStatusMsg<KVAutomataState>[]
        console.log(status)
        expect(status).toHaveLength(4)

        const height = status.map((item) => item.height)
        expect([...new Set(height)]).toEqual([numRequest])

        const lowWaterMark = status.map((item) => item.lowWaterMark)
        expect([...new Set(lowWaterMark)]).toEqual([numRequest])
    })
})
