export type RetryOptions = {
    maxAttempts: number // inclusive, must be >= 1
    initialDelay: number // ms
    backoffMultiplier: number
    maxDelay?: number // ms
    filter?: (error: Error) => boolean // only retry if filter returns true
    logger?: (msg: string) => void // trace tries
};

export const DefaultRetryOptions: RetryOptions = {
    maxAttempts: 3,
    initialDelay: 100,
    backoffMultiplier: 2,
}

export class RetryError extends Error {
    constructor(public message: string, public lastTryIndex: number, public errors: Error[]) {
        super(message)
        this.name = 'RetryError'
    }
}

export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = DefaultRetryOptions): Promise<T> {
    const { maxAttempts, initialDelay, backoffMultiplier, filter: errorFilter, maxDelay, logger } = options
    if (maxAttempts < 1) {
        throw new Error('maxAttempts must be >= 1')
    }
    if (initialDelay < 0) {
        throw new Error('initialDelay must be >= 0')
    }
    if (backoffMultiplier < 0) {
        throw new Error('backoffMultiplier must be >= 0')
    }

    let currentDelay = initialDelay
    const errors: Error[] = []

    for (let i = 0; i < maxAttempts; i++) {
        try {
            logger?.(`retrying ${i + 1} time`)
            const result = await fn()
            return result
        } catch (err) {
            const error = err as Error
            logger?.(`retrying ${i + 1} time, failed with error: ${error.message}`)
            errors.push(error)

            if (errorFilter && !errorFilter(error)) {
                throw new RetryError(`Error filter rejected error: ${error.message}`, i, errors)
            }

            await delay(currentDelay)
            currentDelay *= backoffMultiplier
            if (maxDelay && currentDelay > maxDelay) {
                currentDelay = maxDelay
            }
        }
    }

    throw new RetryError(`Exceeded maximum number of retries (${maxAttempts}).`, maxAttempts - 1, errors)
}
function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}
