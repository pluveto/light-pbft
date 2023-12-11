import { Semaphore } from 'async-mutex'

export class WaitGroup {
    private semaphore: Semaphore
    private counter: number = 0

    get current(): number {
        return this.counter
    }

    constructor(initialCount: number = 0) {
        if (initialCount < 0) {
            throw new Error('Initial wait group count cannot be negative')
        }
        this.counter = initialCount
        this.semaphore = new Semaphore(1)
        if (initialCount > 0) {
            this.semaphore.acquire().then(([, release]) => {
                this.release = release
            })
        }
    }

    private release: (() => void) | null = null

    public incr(delta: number = 1): void {
        if (delta < 0) {
            throw new Error('Cannot add a negative delta to wait group')
        }
        if (delta === 0) {
            return
        }
        if (this.counter === 0 && this.release) {
            this.semaphore.acquire().then(([, release]) => {
                this.release = release
            })
        }
        this.counter += delta
    }

    public decr(): void {
        if (this.counter === 0) {
            throw new Error('WaitGroup counter cannot be negative')
        }
        this.counter--
        if (this.counter === 0 && this.release) {
            this.release()
            this.release = null
        }
    }

    public async wait(): Promise<void> {
        await this.semaphore.acquire()
        this.semaphore.release()
    }
}
