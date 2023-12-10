import { Logger } from './logger'

export class Timer {
    running?: NodeJS.Timeout
    timeout: number
    callback: () => void
    logger?: Logger

    constructor(timeout: number, callback: () => void, logger?: Logger) {
        this.timeout = timeout
        this.callback = callback
        this.logger = logger
    }

    start() {
        if (this.running) {
            this.logger?.error('timer already running but start is called')
            return
        }
        this.running = setTimeout(this.callback, this.timeout)
        this.logger?.debug('timer started')
    }

    cancel() {
        if (!this.running) {
            this.logger?.error('timer not running but cancel is called')
            return
        }
        clearTimeout(this.running)
        this.running = undefined
        this.logger?.debug('timer cancelled')
    }

    reset() {
        this.cancel()
        this.start()
    }
}
