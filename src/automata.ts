import { NamedLogger } from './logger'

export interface Automata<TStatus> {
    transfer(tx: string): void
    status(): TStatus
}


export class RWAutomata implements Automata<ReturnType<RWAutomata['status']>> {
    state: Map<string, string> = new Map()
    history: string[] = []

    constructor(private logger: NamedLogger) {
    }
    transfer(tx: string) {
        this.logger.info('transferring', tx)
        const [key, value] = tx.split(':')
        this.state.set(key, value!)
        this.history.push(tx)
        this.logger.info('transferred')
    }

    read(key: string): string | undefined {
        return this.state.get(key)
    }

    status() {
        return {
            state: this.state,
            history: this.history,
        }
    }

}
