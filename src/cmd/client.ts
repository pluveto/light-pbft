import chalk from 'chalk'
import { Client } from '../client'
import { FindMasterMsg, MasterInfoMsg, QueryStatusMsg, RequestMsg } from '../message'
import { readConfig } from '../config'
import { Optional } from '../types'
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

function selectMajor<T>(arr: T[]): Optional<T> {
    const thold = Math.floor(arr.length * 2 / 3)
    console.log(thold)

    const counter = new Map<string, number>()
    for (const item of arr) {
        const encoded = JSON.stringify(item)
        const count = counter.get(encoded) || 0
        counter.set(encoded, count + 1)
    }
    for (const [item, count] of counter) {
        if (count > thold) {
            return JSON.parse(item)
        }
    }
    return undefined
}

async function main() {
    const nodes = readConfig().nodes
    if (nodes.length === 0) {
        console.error('no node metadata found')
        return
    }
    const z = new Client(nodes)
    const exit = false
    const setupCommands = [
        ['find-master'],
        ['status'],
    ]

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
        const [cmd, args] = await nextCommand()
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
                const msg: RequestMsg = {
                    type: 'request',
                    timestamp: Date.now(),
                    payload: args[0],
                }
                const ret = z.send(msg)
                console.log('request ret: %o', ret)
                break
            }
            case 'find-master': {
                const msg: FindMasterMsg = {
                    type: 'find-master',
                }
                const ret = await z.boardcast(msg)
                const majorRet = selectMajor(ret)
                if (majorRet) {
                    const master = (majorRet as MasterInfoMsg).master_name
                    z.master = master
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