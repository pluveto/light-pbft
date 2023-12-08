import { readConfig } from '../config'
import { serve } from '../serve'

async function main() {
    const systemConfig = readConfig(process.env.CONFIG_PATH)
    systemConfig.nodes.map((node) => {
        serve(node.name, systemConfig)
    })
}

main()
