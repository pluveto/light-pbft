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
        // Ensure the stack trace is captured correctly on older versions of V8/Node.js
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, RetryError)
        }
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
    if (backoffMultiplier < 1) { // this should be >= 1 to avoid infinite loop or zero delay
        throw new Error('backoffMultiplier must be >= 1')
    }

    let currentDelay = initialDelay
    const errors: Error[] = []

    for (let i = 0; i < maxAttempts; i++) {
        try {
            logger?.(`Attempt ${i + 1} of ${maxAttempts}`)
            const result = await fn()
            logger?.(`Attempt ${i + 1} succeeded`)
            return result
        } catch (err) {
            const error = err as Error
            logger?.(`Attempt ${i + 1} failed with error: ${error.message}`)
            errors.push(error)

            if (errorFilter && !errorFilter(error)) {
                throw new RetryError(`Error filter rejected error: ${error.message}`, i, errors)
            }

            if (i < maxAttempts - 1) { // Only delay if there will be another attempt
                await delay(currentDelay)
                currentDelay = nextDelay(currentDelay, backoffMultiplier, maxDelay)
            }
        }
    }

    throw new RetryError(`Exceeded maximum number of retries (${maxAttempts}).`, maxAttempts - 1, errors)
}

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function nextDelay(currentDelay: number, backoffMultiplier: number, maxDelay?: number): number {
    let nextDelay = currentDelay * backoffMultiplier
    if (maxDelay !== undefined && nextDelay > maxDelay) {
        nextDelay = maxDelay
    }
    return nextDelay
}
