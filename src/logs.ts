import { Logger } from './logger'
import { LogMessage } from './message'
import { Optional } from './types'


type DigestFn = (msg: LogMessage) => string

type LogEntry = [string, LogMessage]

export class Logs {
    entries: LogEntry[] = []
    digest: DigestFn
    logger?: Logger

    constructor(logger: Logger, digest: DigestFn) {
        this.logger = logger
        this.digest = digest
    }

    async append(...msgs: LogMessage[]) {
        msgs.forEach(msg => {
            const digest = this.digest(msg)
            const entry: LogEntry = [digest, msg]
            this.logger?.debug('appending', entry)
            this.entries.push(entry)
        })
    }

    select<T extends LogMessage>(predicate: (msg: LogMessage) => boolean): T[] {
        return this.entries.filter(([, msg]) => predicate(msg)).map(([, msg]) => msg) as T[]
    }

    count(predicate: (msg: LogMessage) => boolean): number {
        return this.entries.filter(([, msg]) => predicate(msg)).length
    }

    first<T extends LogMessage>(predicate: (msg: LogMessage) => boolean) {
        for (const [, msg] of this.entries) {
            if (predicate(msg)) {
                return msg as T
            }
        }

        return undefined
    }

    exists(arg: LogMessage | ((msg: LogMessage) => boolean)): boolean {
        if (typeof arg === 'function') {
            return this.entries.some(([, msg]) => arg(msg))
        }
        const digest = this.digest(arg)
        return this.entries.some(([d]) => d === digest)
    }

    last<T extends LogMessage>(predicate: (msg: LogMessage) => boolean): Optional<T> {
        for (let i = this.entries.length - 1; i >= 0; i--) {
            const [, msg] = this.entries[i]
            if (predicate(msg)) {
                return msg as T
            }
        }

        return undefined
    }

    clear(predicate: (msg: LogMessage) => boolean): void {
        if (this.logger) {
            this.logger.debug('clearing logs', this.entries.filter(([, msg]) => predicate(msg)).map(([, msg]) => msg))
        }
        this.entries = this.entries.filter(([, msg]) => !predicate(msg))
    }
}
