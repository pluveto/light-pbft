import { readConfig } from '../config'
import { serve } from '../serve'

async function main() {
    const systemConfig = readConfig()
    systemConfig.nodes.map((node) => {
        serve(node.name, systemConfig)
    })
}

main()
