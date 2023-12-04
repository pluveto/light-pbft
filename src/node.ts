import { WebSocketServer, WebSocket } from 'ws'
import { getAvailablePort } from './util'

const registry = new Map<string, Node>() // address -> node

export class Node {
    public port!: number
    public id!: string
    // address -> connection
    public connections: Map<string, WebSocket> = new Map()

    private constructor() { }

    static async create(id?: string) {
        const node = new Node()
        node.port = await getAvailablePort()
        node.id = id ?? node.port.toString()
        registry.set(node.address, node)
        return node
    }

    get address() {
        return `ws://localhost:${this.port}`
    }

    get peers() {
        return Array.from(registry.keys()).filter((addr) => addr !== this.address)
    }

    start() {
        const wss = new WebSocketServer({ port: this.port })
        wss.on('error', (err) => {
            console.error(`[${this.id}] error: %s`, err)
        })

        wss.on('listening', () => {
            console.log(`[${this.id}] listening on %s`, this.address)

            this.live()
        })

        wss.on('connection', (ws) => {
            ws.on('error', (err) => {
                console.error(`[${this.id}] error: %s`, err)
            })

            ws.on('message', (data) => {
                console.log(`[${this.id}] received: %s`, data)
            })
        })
    }

    live() {
        setInterval(() => {
            this.peers.forEach((peer) => {
                const ws = this.connections.get(peer)
                if (!ws) {
                    this.connect(peer)
                    return
                }

                ws.send('hello')
            })
        }, 2000)
    }

    connect(peer: string) {
        const ws = new WebSocket(peer)
        this.connections.set(peer, ws)
        ws.on('error', (err) => {
            console.error(`[${this.id}] error: %s`, err)
        })

        ws.on('open', () => {
            ws.send('something')
        })

        ws.on('message', (data) => {
            console.log(`[${this.id}] received: %s`, data)
        })
    }
}
