import { describe, expect, it } from 'vitest'
import {
  isEscapeStopSuppressed,
  withEscapeStopSuppressed
} from '../app/src/main/escape-stop'

describe('escape stop suppression', () => {
  it('suppresses escape only inside the desktop key scope', async () => {
    expect(isEscapeStopSuppressed()).toBe(false)
    await withEscapeStopSuppressed(async () => {
      expect(isEscapeStopSuppressed()).toBe(true)
      await withEscapeStopSuppressed(async () => {
        expect(isEscapeStopSuppressed()).toBe(true)
      })
      expect(isEscapeStopSuppressed()).toBe(true)
    })
    expect(isEscapeStopSuppressed()).toBe(false)
  })

  it('resets suppression after an error', async () => {
    await expect(
      withEscapeStopSuppressed(async () => {
        throw new Error('desktop key failed')
      })
    ).rejects.toThrow('desktop key failed')
    expect(isEscapeStopSuppressed()).toBe(false)
  })
})