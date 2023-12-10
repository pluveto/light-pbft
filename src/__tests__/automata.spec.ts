import { Automata, KVAutomata, KVAutomataState } from '../automata'


describe('KVAutomata', () => {
    let automata: Automata<KVAutomataState>

    beforeEach(() => {
        automata = new KVAutomata()
    })

    test('transfer and query', () => {
        automata.transfer('key1:value1')
        automata.transfer('key2:value2')
        automata.transfer('key3:value3')

        expect(automata.query('key1')).toBe('value1')
        expect(automata.query('key2')).toBe('value2')
        expect(automata.query('key3')).toBe('value3')
    })

    test('transfer and delete', () => {
        automata.transfer('key1:value1')
        automata.transfer('key1')

        expect(automata.query('key1')).toBeUndefined()
    })

    test('transfer and status', () => {
        automata.transfer('key1:value1')
        automata.transfer('key2:value2')
        automata.transfer('key3:value3')

        const status = automata.status()
        expect(status.state).toEqual({ key1: 'value1', key2: 'value2', key3: 'value3' })
        expect(status.history).toEqual(['key1:value1', 'key2:value2', 'key3:value3'])
    })

    test('transfer and digest', () => {
        automata.transfer('key1:value1')
        const digest1 = automata.digest()

        automata.transfer('key2:value2')
        const digest2 = automata.digest()

        automata.transfer('key3:value3')
        const digest3 = automata.digest()

        expect(digest1).not.toBe(digest2)
        expect(digest2).not.toBe(digest3)
    })
})
