import { NodeConfig } from './config'
import jaysom from 'jayson/promise'
import { Message } from './message'
import { boardcast } from './util'



export class Client {
    /**
     * send a message to master node
     */
    send<T extends Message>(msg: T): Promise<Message> {
        if (!this.master) {
            throw new Error('master not set')
        }
        return this.nodes.get(this.master)!.request(msg.type, msg)
    }
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

    async boardcast<T extends Message>(payload: T): Promise<Message[]> {
        const nodes = [...this.nodes.values()]
        return boardcast(nodes, payload)
    }


}
