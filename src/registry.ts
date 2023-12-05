interface NodeInterface {
    address: string
    id: number
}

export class Registry {

    private addr2node = new Map<string, NodeInterface>()
    private id2node = new Map<number, NodeInterface>()
    maxMalNodes: number = 1

    public constructor(options: { maxMalNodes: number }) {
        this.maxMalNodes = options.maxMalNodes
    }

    preStartCheck() {
        if (this.size < 3 * this.maxMalNodes + 1) {
            throw new Error('Not enough nodes to start')
        }
    }

    add(node: NodeInterface) {
        if (this.addr2node.has(node.address)) {
            throw new Error('Node already registered')
        }
        this.addr2node.set(node.address, node)
        this.id2node.set(node.id, node)
    }

    resolve(address: string) {
        return this.addr2node.get(address)
    }

    get(id: number) {
        return this.id2node.get(id)
    }

    keys() {
        return this.addr2node.keys()
    }

    get size() {
        return this.addr2node.size
    }
}
