export class WaitGroup {
    private counter: number = 0
    private queue: (() => void)[] = []

    constructor(initialCount: number = 0) {
        if (initialCount < 0) {
            throw new Error('Initial wait group count cannot be negative')
        }
        this.counter = initialCount
    }

    public incr(delta: number = 1): void {
        if (delta < 0) {
            throw new Error('Cannot add a negative delta to wait group')
        }
        this.counter += delta
    }

    public decr(): void {
        this.counter--
        if (this.counter === 0) {
            this.resolveQueue()
        } else if (this.counter < 0) {
            throw new Error('WaitGroup counter cannot be negative')
        }
    }

    public wait(): Promise<void> {
        return new Promise((resolve) => {
            if (this.counter === 0) {
                resolve()
            } else {
                this.queue.push(resolve)
            }
        })
    }

    private resolveQueue(): void {
        while (this.queue.length > 0) {
            const resolve = this.queue.shift()
            if (resolve) {
                resolve()
            }
        }
    }
}
