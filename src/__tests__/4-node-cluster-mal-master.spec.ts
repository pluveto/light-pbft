import { KVAutomataState } from '../automata'
import { Client } from '../client'
import { SystemConfig } from '../config'
import { NodeStatusMsg, QueryStatusMsg, RequestMsg } from '../message'
import { Node } from '../node'
import { serve } from '../serve'
import { createClusterConfig } from './util'

describe('4 Nodes Cluster where f = 1 with master turns malicious', () => {
    jest.setTimeout(10000)

    let client: Client
    let servers: Array<Awaited<ReturnType<typeof serve>>>
    let systemConfig: SystemConfig
    let master: Node<KVAutomataState>

    beforeEach(async () => {
        systemConfig = await createClusterConfig({ size: 4, k: 2 })
        expect(systemConfig.params.f).toBe(1)

        servers = await Promise.all(systemConfig.nodes.map((node) => serve(node.name, systemConfig)))
        client = new Client(systemConfig.nodes)
        client.master = await client.findMaster()
        expect(client.master).toBe(servers[0].node.name)

        master = servers[0].node
    })

    afterEach(async () => {
        await Promise.all(servers.map((server) => server.close()))
    })

    it('should be able to handle a batch of requests one by one', async () => {
        const numRequest = 4
        const rets = []
        for (let i = 0; i < numRequest; i++) {
            if (i === 2) {
                master.corrupt()
            }
            const req: RequestMsg = {
                type: 'request',
                timestamp: Date.now(),
                payload: `key${i}:value${i}`,
            }
            const task = client.request(req)
            rets.push(await task)
        }

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

        // const height = status.map((item) => item.height)
        // expect([...new Set(height)]).toEqual([numRequest])

        // const lowWaterMark = status.map((item) => item.lowWaterMark)
        // expect([...new Set(lowWaterMark)]).toEqual([numRequest])
    })
})
