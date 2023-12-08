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
    })
})
