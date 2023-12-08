import chalk from 'chalk'

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
