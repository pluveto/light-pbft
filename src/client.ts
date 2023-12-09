import { NodeConfig } from './config'
import jaysom from 'jayson/promise'
import { FindMasterMsg, MasterInfoMsg, Message } from './message'
import { multicast, withTimeout } from './util'
import { Optional } from './types'



export class Client {
    private nodes: Map<string, jaysom.client> = new Map()
    master?: string

    constructor(nodes: NodeConfig[]) {
        nodes.map((node) => {
            const client = jaysom.client.http({
                host: node.host,
                port: node.port,
            })
            this.nodes.set(node.name, client)
        })
    }

    /**
     * send a message to master node
     */
    async send<T extends Message>(msg: T, timeout: number = 3000): Promise<Message> {
        if (!this.master) {
            throw new Error('master not set')
        }
        const sendPromise = this.nodes.get(this.master)!.request(msg.type, msg)
        return (await withTimeout(sendPromise, timeout)).result
    }

    /**
     * boardcast a message to all nodes
     */
    async boardcast<T extends Message>(payload: T, timeout: number = Infinity): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return (await withTimeout(multicast(nodes, payload), timeout))
    }

    async findMaster() {
        const msg: FindMasterMsg = {
            type: 'find-master',
        }
        const ret = await this.boardcast(msg) as MasterInfoMsg[]
        const master = findMajority(ret.map((item) => item.name))
        return master
    }
}

/**
 * Find the BFT major element in an array, which is the element that appears more than 2/3 times.
 * 
 * @param arr array of elements
 * @returns the major element if exists, undefined otherwise
 */
export function findMajority<T>(arr: T[]): Optional<T> {
    const thold = Math.floor(arr.length * 2 / 3)

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


