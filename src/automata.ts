import { NamedLogger } from './logger'

export interface Automata<TStatus> {
    transfer(tx: string): void
    status(): TStatus
}


export class KVAutomata implements Automata<ReturnType<KVAutomata['status']>> {
    state: Map<string, string> = new Map()
    history: string[] = []
    height: number = 0
    logger: NamedLogger

    constructor(logger: NamedLogger) {
        this.logger = logger
    }
    transfer(tx: string) {
        this.logger.info('transferring', tx)
        const [key, value] = this.parse(tx)
        if (value === undefined) {
            this.state.delete(key)
        } else {
            this.state.set(key, value)
        }
        this.history.push(tx)
        this.logger.info('transferred')
    }

    parse(tx: string): [string, string | undefined] {
        if (!tx.includes(':')) {
            return [tx, undefined]
        }
        const [key, value] = tx.split(':')
        return [key, value]
    }

    read(key: string): string | undefined {
        return this.state.get(key)
    }

    status() {
        return {
            state: Object.fromEntries(this.state),
            history: this.history,
        }
    }

}
