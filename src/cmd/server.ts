
import { readConfig } from '../config'
import { serve } from '../serve'

async function main() {
    const name = process.argv[2]
    if (!name) {
        console.error('Usage: pnpm run server <node-name>')
        process.exit(1)
    }

    const systemConfig = readConfig(process.env.LIGHT_PBFT_CLUSTER_CONFIG)
    const config = systemConfig.nodes.find((node) => node.name === name)
    if (!config) {
        throw new Error(`node ${name} not found`)
    }

    serve(config.name, systemConfig)
}

main()
