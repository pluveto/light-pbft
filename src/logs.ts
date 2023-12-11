import { Logger } from './logger'
import { LogMessage, LogMessageOfType } from './message'

type DigestFn = (msg: LogMessage) => string;


export class Logs {
    _entries: Map<string, LogMessage[]> = new Map()
    _typeIndex: Map<string, LogMessage[]> = new Map()
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

        const typeIndex = new Map<string, LogMessage[]>()
        for (const messages of this._entries.values()) {
            for (const msg of messages) {
                const typeEntries = typeIndex.get(msg.type)
                if (typeEntries) {
                    typeEntries.push(msg)
                } else {
                    typeIndex.set(msg.type, [msg])
                }
            }
        }
        this._typeIndex = typeIndex
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

            // 更新类型索引
            let typeEntries = this._typeIndex.get(msg.type)
            if (!typeEntries) {
                typeEntries = []
                this._typeIndex.set(msg.type, typeEntries)
            }
            typeEntries.push(msg)
        }
    }

    select<T extends LogMessage['type']>(
        msgType: T,
        predicate?: (msg: LogMessageOfType<T>) => boolean
    ): LogMessageOfType<T>[] {
        const results: LogMessageOfType<T>[] = []
        const messages = this._typeIndex.get(msgType) ?? []

        if (!predicate) {
            return messages as LogMessageOfType<T>[]
        }

        for (const msg of messages) {
            if (predicate(msg as LogMessageOfType<T>)) {
                results.push(msg as LogMessageOfType<T>)
            }
        }
        return results
    }

    count<T extends LogMessage['type']>(msgType: T, predicate?: (msg: LogMessageOfType<T>) => boolean): number {
        const messages = this._typeIndex.get(msgType) ?? []

        if (!predicate) {
            return messages.length
        }

        let count = 0
        for (const msg of messages) {
            if (predicate(msg as LogMessageOfType<T>)) {
                count += 1
            }
        }
        return count
    }

    first<T extends LogMessage['type']>(msgType: T, predicate?: (msg: LogMessageOfType<T>) => boolean): LogMessageOfType<T> | undefined {
        const msgs = this._typeIndex.get(msgType)
        if (!msgs) {
            return undefined
        }

        if (!predicate) {
            return msgs[0] as LogMessageOfType<T>
        }

        for (const msg of msgs) {
            if (predicate(msg as LogMessageOfType<T>)) {
                return msg as LogMessageOfType<T>
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


    last<T extends LogMessage['type']>(msgType: T, predicate?: (msg: LogMessageOfType<T>) => boolean): LogMessageOfType<T> | undefined {
        const msgs = this._typeIndex.get(msgType)
        if (!msgs) {
            return undefined
        }

        if (!predicate) {
            return msgs[msgs.length - 1] as LogMessageOfType<T>
        }

        for (const msg of msgs.reverse()) {
            if (predicate(msg as LogMessageOfType<T>)) {
                return msg as LogMessageOfType<T>
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

        for (const [type, messages] of this._typeIndex) {
            const filteredMessages = messages.filter(msg => !predicate(msg))
            if (filteredMessages.length !== messages.length) {
                if (filteredMessages.length > 0) {
                    this._typeIndex.set(type, filteredMessages)
                } else {
                    this._typeIndex.delete(type)
                }
            }
        }
    }
}
