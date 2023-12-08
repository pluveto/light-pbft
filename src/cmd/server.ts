
import { readConfig } from '../config'
import { serve } from '../serve'

async function main() {
    const name = process.argv[2]
    const systemConfig = readConfig(process.env.CONFIG_PATH)
    const config = systemConfig.nodes.find((node) => node.name === name)
    if (!config) {
        throw new Error('node not found')
    }

    serve(config.name, systemConfig)
}

main()
