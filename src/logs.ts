import { Logger } from './logger'
import { LogMessage } from './message'

type DigestFn = (msg: LogMessage) => string;

export class Logs {
    _entries: Map<string, LogMessage[]> = new Map()
    digest: DigestFn
    logger?: Logger

    set entries(raw: [string, LogMessage][]) {
        const acc = new Map<string, LogMessage[]>()
        for (const [digest, msg] of raw) {
            const _entries = acc.get(digest)
            if (_entries) {
                _entries.push(msg)
            } else {
                acc.set(digest, [msg])
            }
        }
        this._entries = acc
    }

    get entries(): [string, LogMessage][] {
        const entries: [string, LogMessage][] = []
        for (const [digest, messages] of this._entries) {
            for (const msg of messages) {
                entries.push([digest, msg])
            }
        }
        return entries
    }

    constructor(logger: Logger, digest: DigestFn) {
        this.logger = logger
        this.digest = digest
    }

    async append(...msgs: LogMessage[]) {
        for (const msg of msgs) {
            const digest = this.digest(msg)
            this.logger?.debug('appending', [digest, msg])
            let _entries = this._entries.get(digest)
            if (!_entries) {
                _entries = []
                this._entries.set(digest, _entries)
            }
            _entries.push(msg)
        }
    }

    select<T extends LogMessage>(predicate: (msg: LogMessage) => boolean): T[] {
        const results: T[] = []
        for (const messages of this._entries.values()) {
            for (const msg of messages) {
                if (predicate(msg)) {
                    results.push(msg as T)
                }
            }
        }
        return results
    }

    count(predicate: (msg: LogMessage) => boolean): number {
        let count = 0
        for (const messages of this._entries.values()) {
            for (const msg of messages) {
                if (predicate(msg)) {
                    count++
                }
            }
        }
        return count
    }

    first<T extends LogMessage>(predicate: (msg: LogMessage) => boolean): T | undefined {
        for (const messages of this._entries.values()) {
            for (const msg of messages) {
                if (predicate(msg)) {
                    return msg as T
                }
            }
        }
        return undefined
    }

    exists(arg: LogMessage | ((msg: LogMessage) => boolean)): boolean {
        if (typeof arg === 'function') {
            for (const messages of this._entries.values()) {
                if (messages.some(arg)) {
                    return true
                }
            }
        } else {
            const digest = this.digest(arg)
            const _entries = this._entries.get(digest)
            return _entries ? _entries.some(msg => msg === arg) : false
        }
        return false
    }

    last<T extends LogMessage>(predicate: (msg: LogMessage) => boolean): T | undefined {
        const allMessages = Array.from(this._entries.values()).flat().reverse()
        for (const msg of allMessages) {
            if (predicate(msg)) {
                return msg as T
            }
        }
        return undefined
    }

    clear(predicate: (msg: LogMessage) => boolean): void {
        const toClear = new Set<string>()
        for (const [digest, messages] of this._entries) {
            const filteredMessages = messages.filter(msg => !predicate(msg))
            if (filteredMessages.length !== messages.length) {
                this.logger?.debug('clearing logs', filteredMessages)
                if (filteredMessages.length > 0) {
                    this._entries.set(digest, filteredMessages)
                } else {
                    this._entries.delete(digest)
                }
                toClear.add(digest)
            }
        }
    }
}
