import { WaitGroup } from '../waitgroup'

describe('WaitGroup', () => {
    it('exports class constructor', () => {
        expect(typeof WaitGroup).toBe('function')
    })

    it('creates a class instance when run', () => {
        const wg = new WaitGroup()
        expect(wg).toBeInstanceOf(WaitGroup)
    })

    it('instantly returns if no actions taken yet', () => {
        const wg = new WaitGroup()
        const wait = wg.wait()

        return expect(wait).resolves.toEqual(undefined)
    })

    it('waits for internal counter to reach 0', async () => {
        const wg = new WaitGroup()
        let isResolved = false
        wg.incr(2)

        const waiting = wg.wait().then(() => {
            isResolved = true
        })

        expect(isResolved).toEqual(false)

        wg.decr()
        expect(isResolved).toEqual(false)

        wg.decr()
        await expect(waiting).resolves.toEqual(undefined)
        expect(isResolved).toEqual(true)
    })

    it('increments internal counter by default of 1', () => {
        const wg = new WaitGroup()
        wg.incr()
        expect(wg.current).toEqual(1)
    })

    it('increments internal counter given value', () => {
        const wg = new WaitGroup()
        wg.incr(3)
        expect(wg.current).toEqual(3)
    })

    it('throws if incr() results in a negative counter', () => {
        const wg = new WaitGroup()
        expect(wg.incr.bind(wg, -1)).toThrow('Cannot add a negative delta to wait group')
    })

    it('decrements internal counter by 1', () => {
        const wg = new WaitGroup()
        wg.incr(3)
        expect(wg.current).toEqual(3)
        wg.decr()
        expect(wg.current).toEqual(2)
    })

    it('throws if done() results in a negative counter', () => {
        const wg = new WaitGroup()
        expect(wg.decr.bind(wg)).toThrow('WaitGroup counter cannot be negative')
    })
})
