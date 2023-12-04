import WebSocket from 'ws'

export class Client {
    constructor(public readonly id: string) { }

    start() {

        const conn = new WebSocket('ws://localhost:8080')

        conn.on('error', console.error)

        conn.on('open', () => {
            conn.send('something')
        })

        conn.on('message', (data) => {
            console.log(`[${this.id}] received: %s`, data)
        })
    }
}
