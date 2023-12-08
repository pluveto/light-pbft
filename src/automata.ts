import { NamedLogger } from './logger'
import { Optional } from './types'

export type ByteLike = string | Buffer | Uint8Array

export interface Automata<TStatus> {
    // transfer the state machine with a input
    transfer(tx: ByteLike): void
    // query the state machine with a command
    query(key: ByteLike): ByteLike | undefined
    status(): TStatus
}

/**
 * A simple key-value storage automata as an example implementation of Automata.
 */
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

    parse(tx: string): [string, Optional<string>] {
        if (!tx.includes(':')) {
            return [tx, undefined]
        }
        const [key, value] = tx.split(':')
        return [key, value]
    }

    query(command: string): Optional<string> {
        return this.state.get(command)
    }

    status() {
        return {
            state: Object.fromEntries(this.state),
            history: this.history,
        }
    }

}
