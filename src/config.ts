import fs from 'fs'

export interface SystemConfig {
    nodes: NodeConfig[]
}

export interface NodeConfig {
    name: string
    host: string
    port: number
    pubkey: string
    prikey: string
}

export function readConfig(): SystemConfig {
    const file = 'nodes/nodes.json'
    return JSON.parse(fs.readFileSync(file).toString()) as SystemConfig
}
