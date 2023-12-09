import fs from 'fs'

export type SystemConfig = {
    nodes: NodeConfig[]
    params: ParamConfig
}

export type ParamConfig = {
    // f is the max number of faulty nodes tolerated
    f: number
    // k is a big number that is used to calculate the high-water mark
    // if checkpoint is genereated at every 100 requests, then k can be 200
    k?: number
}

export type NodeConfig = {
    name: string
    host: string
    port: number
    pubkey: string
    prikey: string
}

export function readConfig(path?: string): SystemConfig {
    return JSON.parse(fs.readFileSync(path ?? 'nodes/config.json').toString()) as SystemConfig
}
