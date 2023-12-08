import * as jayson from 'jayson/promise'
import { NodeConfig, SystemConfig } from './config'
import { Optional } from './types'
import { Node } from './node'
import { KVAutomata } from './automata'
import { NamedLogger } from './logger'
function maskPriKeys(name: string, systemConfig: SystemConfig) {
    const config = systemConfig.nodes.find((node) => node.name === name)
    if (!config) {
        throw new Error(`node ${name} not found`)
    }
    const ret = { ...systemConfig }
    ret.nodes = systemConfig.nodes.map((node) => {
        if (node.name !== name) {
            return {
                ...node,
                prikey: '******',
            }
        }
        return node
    })
    return ret
}

export async function serve(name: string, systemConfig: SystemConfig) {
    const config: Optional<NodeConfig> = systemConfig.nodes.find((node) => node.name === name)
    if (!config) {
        throw new Error(`node ${name} not found`)
    }
    const systemConfigLocal = maskPriKeys(config.name, systemConfig)
    const node = new Node(config, systemConfigLocal, new KVAutomata(new NamedLogger(config.name).derived('automata')))
    const server = new jayson.Server(node.routes())
    const http = server.http()
    await new Promise<void>((resolve) => {
        http.listen({
            host: config.host,
            port: config.port,
        }, () => {
            console.log(`${config.name} is listening on ${config.host}:${config.port}`)
            resolve()
        })
    })

    return {
        node,
        close: () => new Promise<void>((resolve) => {
            http.close((err) => {
                if (err) {
                    console.error(err)
                }
                console.log(`${config.name} is closed`)
                resolve()
            })
        })
    }
}
