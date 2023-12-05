import WebSocket from 'ws'

const clients = new Map<string, Client>() // address -> node

export class Client {
    public id!: string
    private connection?: WebSocket
    private constructor() { }

    static async create(id?: string) {
        const node = new Client()
        node.id = id ?? 'client'
        clients.set(node.id, node)
        return node
    }

    connect(port: number): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.connection) {
                reject(new Error('Already connected'))
            }

            const conn = new WebSocket('ws://localhost:' + port)

            conn.on('error', (error) => {
                console.error(error)
                reject(error)
            })

            conn.on('open', () => {
                this.connection = conn
                resolve()
            })

            conn.on('message', (data) => {
                console.log(`[${this.id}] received: %s`, data)
            })
        })
    }

    send<T>(msg: T) {
        if (!this.connection) {
            throw new Error('Not connected')
        }

        this.connection.send(JSON.stringify(msg))
    }
}
