import fs from 'fs'
import jsonschema from 'jsonschema'

export type SystemConfig = {
    nodes: NodeConfig[]
    params: ParamConfig
}

export type ParamConfig = {
    // f is the max number of faulty nodes tolerated
    f: number
    // k is a big number that is used to calculate the high-water mark
    // if checkpoint is genereated at every 100 requests, then k can be 200
    k: number
}

export type NodeConfig = {
    name: string
    host: string
    port: number
    pubkey: string
    prikey: string
}

export const schema = {
    '$schema': 'http://json-schema.org/draft-07/schema#',
    'type': 'object',
    'properties': {
        'nodes': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'name': {
                        'type': 'string'
                    },
                    'host': {
                        'type': 'string'
                    },
                    'port': {
                        'type': 'number'
                    },
                    'pubkey': {
                        'type': 'string'
                    },
                    'prikey': {
                        'type': 'string'
                    }
                },
                'required': ['name', 'host', 'port', 'pubkey', 'prikey']
            }
        },
        'params': {
            'type': 'object',
            'properties': {
                'f': {
                    'type': 'number'
                },
                'k': {
                    'type': 'number'
                }
            },
            'required': ['f', 'k']
        }
    },
    'required': ['nodes', 'params']
}

export function readConfig(path?: string): SystemConfig {
    const obj = JSON.parse(fs.readFileSync(path ?? 'nodes/config.json').toString())
    const validator = new jsonschema.Validator()
    const result = validator.validate(obj, schema)
    if (!result.valid) {
        throw new Error(`invalid config: ${result.errors}`)
    }
    return obj as SystemConfig
}
