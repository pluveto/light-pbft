import chalk from 'chalk'

export class NamedLogger {
    constructor(private name: string) { }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private log(fn: typeof console.log, color: chalk.Chalk, message?: any, ...optionalParams: any[]) {
        fn(color(`[${this.name}]`), message, ...optionalParams)
    }

    info = this.log.bind(this, console.info, chalk.blue)

    warn = this.log.bind(this, console.warn, chalk.yellow)

    error = this.log.bind(this, console.error, chalk.red)

    debug = this.log.bind(this, console.debug, chalk.green)

    derived(name: string) {
        return new NamedLogger(`${this.name}:${name}`)
    }
}
