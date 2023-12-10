import { retry, RetryError, RetryOptions } from '../retry'

function createMockFunction() {
    return jest.fn().mockImplementation(() => {
        throw new Error('Test error')
    })
}

const options: RetryOptions = {
    maxAttempts: 3,
    initialDelay: 100,
    backoffMultiplier: 2,
}

describe('retry function', () => {
    beforeEach(() => {
        jest.useFakeTimers({ advanceTimers: true })
    })

    afterEach(() => {
        jest.useRealTimers()
    })

    it('should not retry when the function succeeds', async () => {
        const mockFn = jest.fn().mockResolvedValue('success')
        const result = await retry(mockFn)
        expect(result).toBe('success')
        expect(mockFn).toHaveBeenCalledTimes(1)
    })

    it('should retry the specified number of times on failure', async () => {
        const mockFn = createMockFunction()
        try {
            await retry(mockFn, { ...options, maxAttempts: 2 })
        } catch (e) {
            expect(mockFn).toHaveBeenCalledTimes(2)
        }
    })

    it('should throw RetryError after exceeding max attempts', async () => {
        const mockFn = createMockFunction()
        await expect(retry(mockFn, { ...options, maxAttempts: 2 })).rejects.toThrow(RetryError)
    })

    it('should respect the max delay between retries', async () => {
        const mockFn = createMockFunction()
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        try {
            await retry(mockFn, { ...options, maxDelay: 200 })
        } catch (e) {
            expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 200)
        }
    })

    it('should stop retrying when the error filter returns false', async () => {
        const mockFn = createMockFunction()
        const filter = jest.fn().mockReturnValue(false)
        try {
            await retry(mockFn, { ...options, filter })
        } catch (e) {
            expect(filter).toHaveBeenCalledTimes(1)
            expect(mockFn).toHaveBeenCalledTimes(1)
        }
    })

    it('should log retries if logger is provided', async () => {
        const mockFn = createMockFunction()
        const logger = jest.fn()
        try {
            await retry(mockFn, { ...options, logger })
        } catch (e) {
            expect(logger).toHaveBeenCalled()
        }
    })

    it('should throw an error if maxAttempts is less than 1', async () => {
        const mockFn = jest.fn()
        await expect(retry(mockFn, { ...options, maxAttempts: 0 })).rejects.toThrow('maxAttempts must be >= 1')
    })

    it('should apply an initial delay before retries', async () => {
        const mockFn = createMockFunction()
        const initialDelay = 100
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        try {
            await retry(mockFn, { ...options, initialDelay })
        } catch (e) {
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), initialDelay)
        }
    })

    it('should exponentially back off on subsequent retries', async () => {
        const mockFn = createMockFunction()
        const initialDelay = 100
        const backoffMultiplier = 2
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        try {
            await retry(mockFn, { ...options, initialDelay, backoffMultiplier, maxAttempts: 3 })
        } catch (e) {
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), initialDelay)
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), initialDelay * backoffMultiplier)
        }
    })

    it('should respect maxDelay when backoffMultiplier is applied', async () => {
        const mockFn = createMockFunction()
        const initialDelay = 100
        const backoffMultiplier = 3
        const maxDelay = 200
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout')
        try {
            await retry(mockFn, { ...options, initialDelay, backoffMultiplier, maxDelay, maxAttempts: 4 })
        } catch (e) {
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(1, expect.any(Function), initialDelay)
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(2, expect.any(Function), maxDelay)
            expect(setTimeoutSpy).toHaveBeenNthCalledWith(3, expect.any(Function), maxDelay)
        }
    })

    it('should throw an error if initialDelay is negative', async () => {
        const mockFn = jest.fn()
        await expect(retry(mockFn, { ...options, initialDelay: -100 })).rejects.toThrow('initialDelay must be >= 0')
    })

    it('should throw an error if backoffMultiplier is negative', async () => {
        const mockFn = jest.fn()
        await expect(retry(mockFn, { ...options, backoffMultiplier: -1 })).rejects.toThrow('backoffMultiplier must be >= 1')
    })

    // Test that RetryError contains the correct lastTryIndex and the array of errors
    it('RetryError should contain the correct lastTryIndex and the errors array', async () => {
        const mockFn = createMockFunction()
        try {
            await retry(mockFn, { ...options, maxAttempts: 2 })
        } catch (e) {
            if (e instanceof RetryError) {
                expect(e.lastTryIndex).toBe(1) // Because it starts with 0
                expect(e.errors).toHaveLength(2)
            } else {
                throw new Error('Error is not an instance of RetryError')
            }
        }
    })

})
