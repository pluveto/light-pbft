import fs from 'fs'

export type SystemConfig = {
    nodes: NodeConfig[]
    params: ParamConfig
}

export type ParamConfig = {
    f: number
}

export type NodeConfig = {
    name: string
    host: string
    port: number
    pubkey: string
    prikey: string
}

export function readConfig(path?: string): SystemConfig {
    const path_ = path ?? 'nodes/config.json'
    return JSON.parse(fs.readFileSync(path_).toString()) as SystemConfig
}
