/* eslint-disable @typescript-eslint/no-explicit-any */
import chalk from 'chalk'

export type Logger = {
    info: (...args: any[]) => void
    warn: (...args: any[]) => void
    error: (...args: any[]) => void
    debug: (...args: any[]) => void
    trace: (...args: any[]) => void
}

export class NamedLogger {
    constructor(private name: string) { }

    info = console.info.bind(console, chalk.blue(`[${this.name}]`))

    warn = console.warn.bind(console, chalk.yellow(`[${this.name}]`))

    error = console.error.bind(console, chalk.red(`[${this.name}]`))

    debug = console.debug.bind(console, chalk.green(`[${this.name}]`))

    trace = console.trace.bind(console, chalk.gray(`[${this.name}]`))

    derived(name: string) {
        return new NamedLogger(`${this.name}:${name}`)
    }
}
