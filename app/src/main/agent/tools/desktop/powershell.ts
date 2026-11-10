import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { ToolError, truncate } from '../types'

const run = promisify(execFile)

/** 每次鼠标动作后的稳定等待：让目标界面完成一次重绘再截图。 */
export const POST_MOUSE_DELAY_MS = 300

/** 等待一段时间，但可以被中止信号提前结束。 */
export function waitFor(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/** 运行一段内嵌 PowerShell 脚本，返回去除首尾空白的 stdout。 */
export async function runPowerShell(
  name: string,
  content: string,
  args: string[],
  timeout = 20_000
): Promise<string> {
  const script = join(tmpdir(), `huaqiang-${name}-${randomUUID()}.ps1`)
  await writeFile(script, content, 'utf8')
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
      { timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
    )
    return stdout.trim()
  } catch (error) {
    const detail =
      error && typeof error === 'object' && 'stderr' in error
        ? String((error as { stderr?: unknown }).stderr ?? '')
        : ''
    throw new ToolError(
      truncate(
        `桌面操作失败${detail ? `：${detail.trim()}` : `：${error instanceof Error ? error.message : String(error)}`}`,
        3_000
      )
    )
  } finally {
    await unlink(script).catch(() => undefined)
  }
}
