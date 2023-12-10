import { readConfig } from '../config'
import { serve } from '../serve'

async function main() {
    const systemConfig = readConfig(process.env.LIGHT_PBFT_CLUSTER_CONFIG)
    systemConfig.nodes.map((node) => {
        serve(node.name, systemConfig)
    })
}

main()
