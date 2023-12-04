import { Node } from './node'

async function main() {
  const a = await Node.create()
  const b = await Node.create()

  a.start()
  b.start()
}

main()
