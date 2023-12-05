import { Client } from './client'
import { RequestMsg } from './message'
import { Node } from './node'
import { Registry } from './registry'



async function main() {

  const registry = new Registry({
    maxMalNodes: 1,
  })

  const a = await Node.create(registry)
  const b = await Node.create(registry)
  const c = await Node.create(registry)
  const d = await Node.create(registry)

  await a.start()
  await b.start()
  await c.start()
  await d.start()

  const z = await Client.create()
  await z.connect(a.port)
  z.send<RequestMsg>({
    type: 'request',
    timestamp: Date.now(),
    payload: 'hello',
  })
}

main()
