import * as net from 'net'

export function getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const server = net.createServer()
        server.on('error', reject)
        server.listen(0, () => {
            const addr = server.address()
            if (typeof addr === 'string') {
                throw new Error('Unexpected string address')
            }
            if (addr === null) {
                throw new Error('Unexpected null address')
            }
            const port = addr.port
            server.close(() => {
                resolve(port)
            })
        })
    })
}
