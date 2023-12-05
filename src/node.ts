import { WebSocketServer, WebSocket } from 'ws'
import { getAvailablePort } from './util'
import { ErrorCode, ErrorMsg, MasterInfoMsg, Message } from './message'
import { Registry } from './registry'

export class Node {
    public port!: number
    public id!: number // 0, 1, 2, 3, ...
    // address -> connection
    public connections: Map<string, WebSocket> = new Map()

    private view: number = 0
    private registry!: Registry

    private constructor() { }

    static async create(registry: Registry) {
        const node = new Node()
        node.port = await getAvailablePort()
        node.id = registry.size
        node.registry = registry
        registry.add(node)
        return node
    }

    get isMaster() {
        return this.id === this.view
    }

    get address() {
        return `ws://localhost:${this.port}`
    }

    get peers() {
        return Array.from(this.registry.keys()).filter((addr) => addr !== this.address)
    }

    async start() {
        this.registry.preStartCheck()

        return new Promise<void>((resolve, reject) => {
            const wss = new WebSocketServer({ port: this.port })
            wss.on('error', (err) => {
                console.error(`[${this.id}] error: %s`, err)
                reject(err)
            })

            wss.on('listening', () => {
                console.log(`[${this.id}] listening on %s`, this.address)
                this.live()
                resolve()
            })

            wss.on('connection', (ws) => {
                ws.on('error', (err) => {
                    console.error(`[${this.id}] error: %s`, err)
                })

                ws.on('message', (data) => {
                    console.log(`[${this.id}] received: %s`, data)
                    let msg
                    try {
                        msg = JSON.parse(data.toString('utf-8'))
                    } catch (error) {
                        console.error(`[${this.id}] invalid message: %s`, data)
                        return
                    }
                    // msg must has a type field
                    if (!msg.type) {
                        console.error(`[${this.id}] invalid message: %s`, data)
                        return
                    }
                    this.onMessage(ws, msg as Message)
                })
            })
        })
    }

    onMessage(ws: WebSocket, data: Message) {
        const source = this.registry.resolve(ws.url)
        if (!source) {
            console.warn(`[${this.id}] message from non-peer: %s`, data)
        }

        switch (data.type) {
            case 'error': {
                const err = data as ErrorMsg
                console.error(`[${this.id}] error: %s, %s`, err.code, err.message)
                break
            }
            case 'find-master': {
                this.send<MasterInfoMsg>({
                    type: 'master-info',
                    master_addr: this.registry.get(this.view)!.address,
                }, ws)
                break
            }
            case 'master-info': {
                this.send<ErrorMsg>({
                    type: 'error',
                    code: ErrorCode.INVALID_TYPE,
                    message: 'I don\'t need master info',
                }, ws)
                break
            }
            case 'request': {
                if (!this.isMaster) {
                    this.send<ErrorMsg>({
                        type: 'error',
                        code: ErrorCode.NOT_MASTER,
                        message: 'I am not the master',
                    }, ws)
                }
                break
            }
            default: {
                this.send<ErrorMsg>({
                    type: 'error',
                    code: ErrorCode.INVALID_TYPE,
                    message: 'Unknown message type',
                }, ws)
            }
        }
    }

    send<T>(msg: T, ws?: WebSocket) {
        const data = JSON.stringify(msg)
        if (ws) {
            ws.send(data)
            return
        }

        this.connections.forEach((ws) => {
            ws.send(data)
        })
    }

    live() {
        setInterval(() => {
            const ids = Array.from(this.connections.keys()).map((addr) => this.registry.resolve(addr)!.id).join(', ')
            console.error(`[${this.id}] connections: [%s]`, ids)
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
            console.log(`[${this.id}] connected to %s`, peer)
        })

        ws.on('message', (data) => {
            console.log(`[${this.id}] received: %s`, data)
        })
    }
}
