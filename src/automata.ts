import { Logger } from './logger'
import { Optional } from './types'
import crypto from 'crypto'

export type ByteLike = string | Buffer | Uint8Array

export interface Automata<TStatus> {
    // transfer the state machine with a input
    transfer(tx: ByteLike): void
    // query the state machine with a command
    query(command: ByteLike): ByteLike | undefined
    status(): TStatus
    digest(): string
}

export type KVAutomataState = ReturnType<KVAutomata['status']>

/**
 * A simple key-value storage automata as an example implementation of Automata.
 */
export class KVAutomata implements Automata<KVAutomataState> {
    state: Map<string, string> = new Map()
    history: string[] = []
    height: number = 0
    logger?: Logger
    lastDigest: string = ''

    constructor(logger?: Logger) {
        this.logger = logger
    }

    transfer(tx: string) {
        this.logger?.info('transferring', tx)
        const [key, value] = this.parse(tx)
        if (value === undefined) {
            this.state.delete(key)
        } else {
            this.state.set(key, value)
        }
        this.height++

        const hash = crypto.createHash('sha256')
        hash.update(this.lastDigest + tx)
        this.lastDigest = hash.digest('hex')

        this.history.push(tx)
        this.logger?.info('transferred')
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
            digest: this.lastDigest,
            history: this.history,
        }
    }

    digest(): string {
        return this.lastDigest
    }
}
