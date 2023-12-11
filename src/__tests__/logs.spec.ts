// logs.test.js
import { Logs } from '../logs'
import { Logger } from '../logger'
import { CommittedLogMsg, LogMessage } from '../message'
import { Optional } from '../types'

describe('Logs', () => {
    let logs: Logs
    let logger: Logger
    let digestFn: (msg: LogMessage) => string
    let mockMessage: CommittedLogMsg

    beforeEach(() => {
        logger = console // Assuming Logger is already implemented
        digestFn = jest.fn(msg => JSON.stringify(msg)) // A simple mock digest function
        logs = new Logs(logger, digestFn)
        mockMessage = {
            type: 'committed',
            digest: '',
            node: 'node1',
            sequence: 0,
            view: 0
        }
    })

    it('append should add entries', async () => {
        await logs.append(mockMessage)
        expect(logs.entries.length).toBe(1)
    })

    it('select should return filtered entries', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        const selected = logs.select(msg => msg.type === 'committed' && msg.node === 'node1') as CommittedLogMsg[]
        expect(selected.length).toBe(1)
        expect(selected[0].node).toBe('node1')
    })

    it('count should return the number of entries matching the predicate', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        const count = logs.count(msg => msg.type === 'committed' && msg.node === 'node1')
        expect(count).toBe(1)
    })

    // Similar tests can be written for `first`, `exists`, `last`, and `clear` methods.
    it('first should return the first entry matching the predicate', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        const first = logs.first(msg => msg.type === 'committed' && msg.node === 'node1') as Optional<CommittedLogMsg>
        expect(first?.node).toBe('node1')
    })

    it('exists should return true if an entry matching the predicate exists', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        const exists = logs.exists(msg => msg.type === 'committed' && msg.node === 'node1')
        expect(exists).toBe(true)
    })

    it('last should return the last entry matching the predicate', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        const last = logs.last(msg => msg.type === 'committed' && msg.node === 'node1') as Optional<CommittedLogMsg>
        expect(last?.node).toBe('node1')
    })

    it('clear should remove entries matching the predicate', () => {
        logs.entries = [['digest1', mockMessage], ['digest2', { ...mockMessage, node: 'node2' }]]
        logs.clear(msg => msg.type === 'committed' && msg.node === 'node1')
        expect(logs.entries.length).toBe(1)
    })
})
