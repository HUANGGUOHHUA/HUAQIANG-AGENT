let suppressDepth = 0

export function isEscapeStopSuppressed(): boolean {
  return suppressDepth > 0
}

/**
 * Desktop tools may send ESC to the target application (e.g. closing a menu).
 * That synthetic key must not be treated as the user's emergency stop.
 */
export async function withEscapeStopSuppressed<T>(run: () => Promise<T>): Promise<T> {
  suppressDepth += 1
  try {
    return await run()
  } finally {
    suppressDepth = Math.max(0, suppressDepth - 1)
  }
}