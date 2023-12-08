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
