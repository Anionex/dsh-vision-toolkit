import { afterEach, describe, expect, it, vi } from 'vitest'
import { withWindowsTransientRetry } from '../src/runtime-install.ts'

function transientError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`code ${code}`), { code })
}

describe('withWindowsTransientRetry', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('passes successful operations through unchanged', async () => {
    const operation = vi.fn(async () => 'ok')
    await expect(withWindowsTransientRetry(operation)).resolves.toBe('ok')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries transient EBUSY failures on Windows until they succeed', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const operation = vi.fn(async () => {
      if (operation.mock.calls.length < 3) throw transientError('EBUSY')
    })
    await expect(withWindowsTransientRetry(operation)).resolves.toBeUndefined()
    expect(operation).toHaveBeenCalledTimes(3)
  })

  it('gives up after the retry budget when Windows keeps failing', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const error = transientError('EPERM')
    const operation = vi.fn(async () => {
      throw error
    })
    await expect(withWindowsTransientRetry(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(5)
  })

  it('does not retry non-transient errors', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const error = transientError('ENOENT')
    const operation = vi.fn(async () => {
      throw error
    })
    await expect(withWindowsTransientRetry(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('does not retry on non-Windows platforms', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const error = transientError('EBUSY')
    const operation = vi.fn(async () => {
      throw error
    })
    await expect(withWindowsTransientRetry(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
