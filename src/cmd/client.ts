import chalk from 'chalk'
import { Client, findMajority } from '../client'
import { FindMasterMsg, MasterInfoMsg, QueryStatusMsg, RequestMsg } from '../message'
import { NodeConfig, readConfig } from '../config'
import { quote } from '../util'

export async function repl() {
    return await new Promise<string[]>((resolve) => {
        process.stdin.once('data', (data) => {
            resolve(data.toString().trim().split(/\s+/))
        })
    })
}

function printHelp() {
    const help = {
        'help': 'print this message',
        'exit': 'exit client',
        'request <payload>': 'send request to BFT cluster',
        'find-master': 'find master node',
        'status': 'query status of all nodes',
        'corrupt <node-name>': 'make a node be a malicious byzantine node',
    }
    console.log('commands:')
    for (const [cmd, desc] of Object.entries(help)) {
        console.log(`  ${chalk.green(cmd)}: ${desc}`)
    }

}



function printNodes(nodes: NodeConfig[]) {
    console.log('nodes:')
    for (const node of nodes) {
        console.log(`\t${node.name} ${node.host}:${node.port}`)
    }
}

async function main() {
    const configPath = process.env.LIGHT_PBFT_CLUSTER_CONFIG
    const systemConfig = readConfig(configPath)
    const { clients, nodes } = systemConfig
    if (nodes.length === 0) {
        console.error('no node metadata found')
        return
    }

    printNodes(nodes)

    if (clients.length === 0) {
        console.error('no client metadata found')
        return
    }

    const clientName = process.argv[2]
    if (!clientName) {
        console.error('Usage: pnpm run client <client-name>')
        process.exit(1)
    }

    const client = clients.find((client) => client.name === clientName)

    if (!client) {
        console.error(`client ${clientName} not found`)
        return
    }

    const z = new Client(client, nodes, systemConfig.signature.enabled)
    const exit = false
    const setupCommands: string[][] = [
        // ['status'],
        // ['find-master'],
        // ['request', 'key1:value1'],
        // ['status']
    ].reverse()

    const nextCommand = async () => {
        const poped = setupCommands.pop()
        if (poped) {
            const args = poped.slice(1).map(quote).join(' ')
            process.stdout.write(`client(setup)> ${poped[0]} ${args}\n`)
            return poped
        } else {
            process.stdout.write('client> ')
            return await repl()
        }
    }

    while (!exit) {
        const [cmd, ...args] = await nextCommand()
        switch (cmd) {
            case 'help':
                printHelp()
                break

            case 'status': {
                const ret = await z.boardcast<QueryStatusMsg>({
                    type: 'query-status',
                })
                console.log('status: %o', ret)
                break
            }

            case 'request': {
                if (!args[0]) {
                    console.error('request need payload')
                    console.log('usage: request <payload>')
                    break
                }
                const msg: RequestMsg = {
                    type: 'request',
                    timestamp: Date.now(),
                    payload: args[0],
                }
                const ret = await z.request(msg)
                console.log('request ret: %o', ret)
                break
            }
            case 'find-master': {
                const msg: FindMasterMsg = {
                    type: 'find-master',
                }
                const ret = await z.boardcast(msg)
                const majorRet = findMajority(ret)
                if (majorRet) {
                    const master = (majorRet as MasterInfoMsg).name
                    console.log('%s', master)
                } else {
                    console.error('no master found')
                }
                break
            }
            case 'corrupt': {
                if (!args[0]) {
                    console.warn('corrupt need node name')
                    console.log('usage: corrupt <node-name>')
                    break
                }
                const node = nodes.find((node) => node.name === args[0])
                if (!node) {
                    console.error('node not found')
                    break
                }
                const ret = await z.send({
                    type: 'corrupt',
                    name: node.name,
                })
                console.log('corrupt ret: %o', ret)
                break
            }
            default: {
                console.log('unknown command: %s', cmd)
                break
            }
        }
    }

}

main()
