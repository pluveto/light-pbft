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
    console.log(chalk.green('help'), 'print this message')
    console.log(chalk.green('exit'), 'exit client')
    console.log(chalk.green('request <payload>'), 'send request to target')
    console.log(chalk.green('find-master'), 'find master node')
}



function printNodes(nodes: NodeConfig[]) {
    console.log('nodes:')
    for (const node of nodes) {
        console.log(`\t${node.name} ${node.host}:${node.port}`)
    }
}

async function main() {
    console.log(process.env.CONFIG_PATH)

    const systemConfig = readConfig(process.env.CONFIG_PATH)
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

    const z = new Client(clients[0], nodes, systemConfig.signature.enabled)
    const exit = false
    const setupCommands = [
        ['status'],
        ['find-master'],
        ['request', 'key1:value1'],
        ['status']
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
                    console.log('master is %s', master)
                } else {
                    console.log('no master found')
                }
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
