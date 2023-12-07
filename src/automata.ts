export interface Automata<T> {
    transfer(tx: T): void
}

export interface WriteAction {
    type: 'write'
    key: string
    value?: string
}

export class RWAutomata implements Automata<WriteAction> {
    state: Map<string, string> = new Map()
    history: WriteAction[] = []
    transfer(tx: WriteAction) {
        this.state.set(tx.key, tx.value!)
        this.history.push(tx)
    }

    read(key: string): string | undefined {
        return this.state.get(key)
    }
}
