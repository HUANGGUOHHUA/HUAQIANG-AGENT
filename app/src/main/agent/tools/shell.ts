import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { toolTempEnv } from '../../child-env'
import { resolveWithinRoot } from '../../security/paths'
import type { ToolDefinition } from './types'
import { ToolError, numberArg, stringArg, stripAnsi, truncate } from './types'

const MAX_OUTPUT = 200_000

// 用脚本重造鼠标/键盘输入或 OCR 的迹象。桌面自动化应走专用工具：
// 这些内联脚本会卡住、超时，而且和接管高亮/审批脱节。
const SYNTHETIC_INPUT_RE = /(\bmouse_event\b|\bkeybd_event\b|\bSendInput\b|\bSetCursorPos\b|\bBlockInput\b)/i
const SCRIPT_OCR_RE = /(Windows\.Media\.Ocr|\bOcrEngine\b|\btesseract\b|osd\.traineddata)/i

/** System-level commands that must still be confirmed in auto mode. */
const SYSTEM_COMMAND_RE =
  /(\bformat\b|\bdiskpart\b|\bshutdown\b|\breg\s+(add|delete|import)\b|\bnet\s+(user|localgroup)\b|\bsc\s+(config|delete|create)\b|\bSet-ExecutionPolicy\b|\bbcdedit\b|\bicacls\b|\btakeown\b|\bRemove-Item\b[^\n]*\b(C:\\Windows|System32)\b|\bStart-Process\b[^\n]*-Verb\s+RunAs\b)/i

export function isDangerousCommand(command: string): boolean {
  return SYSTEM_COMMAND_RE.test(command)
}

/** 命令是否在“重造”桌面自动化能力；返回给模型的纠正提示。 */
export function desktopAutomationHint(command: string): string | null {
  if (SYNTHETIC_INPUT_RE.test(command)) {
    return (
      '不要用 run_command 里的 Win32 调用模拟鼠标或键盘（mouse_event / keybd_event / SendInput）。' +
      '直接用 mouse_move、mouse_click、mouse_drag、keyboard_type、keyboard_press；' +
      'keyboard_type 在 SendInput 被拦截时会自动改用剪贴板粘贴。' +
      '如果是用户明确要求编写这类程序，请先用 write_file 保存脚本，再运行该文件。'
    )
  }
  if (SCRIPT_OCR_RE.test(command)) {
    return (
      '不要用 run_command 自己调用 OCR 引擎（Windows.Media.Ocr / Tesseract）。' +
      '直接用 screen_ocr（可传 region_x/y/width/height 只识别目标区域）、screen_click(text=...)，' +
      '或者 screen_click_target(target=...) 按描述点击。' +
      '如果是用户明确要求编写 OCR 脚本，请先用 write_file 保存，再运行该文件。'
    )
  }
  return null
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  const full = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(full) ? full : 'powershell.exe'
}

function killTree(pid: number | undefined): void {
  if (!pid) return
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      killer.unref()
    } else {
      process.kill(-pid, 'SIGKILL')
    }
  } catch {
    // Process may already be gone.
  }
}

export const runCommandTool: ToolDefinition = {
  name: 'run_command',
  displayName: '运行命令',
  risk: 'exec',
  confirmInAutoWhen: (args) => isDangerousCommand(stringArg(args, 'command')),
  description:
    '在本机 PowerShell 中执行命令，工作目录默认为工作区。适合安装依赖、构建、运行测试、Git 操作等。命令会实时返回输出；用户会看到并确认命令内容。不要执行删除系统文件、修改系统设置或泄露密钥的操作。',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: '要执行的 PowerShell 命令' },
      cwd: { type: 'string', description: '相对工作区的执行目录，默认工作区根目录' },
      timeout_ms: { type: 'number', description: '超时时间（毫秒），默认 120000，最大 600000' }
    },
    required: ['command'],
    additionalProperties: false
  },
  summarize: (args) => {
    const command = stringArg(args, 'command').replace(/\s+/g, ' ').trim()
    return `执行 ${command.length > 100 ? `${command.slice(0, 100)}…` : command || '?'}`
  },
  execute: async (args, context) => {
    const command = stringArg(args, 'command', { required: true, max: 20_000 })
    if (!command.trim()) throw new ToolError('命令不能为空')
    const hint = desktopAutomationHint(command)
    if (hint) throw new ToolError(hint)
    const cwd = await resolveWithinRoot(context.workspace, stringArg(args, 'cwd', { fallback: '.' }) || '.')
    const timeout = numberArg(args, 'timeout_ms', 120_000, 1_000, 600_000)

    const isWindows = process.platform === 'win32'
    let executable: string
    let shellArgs: string[]
    if (isWindows) {
      const prefixed = [
        "$ErrorActionPreference='Continue'",
        '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false)',
        '$OutputEncoding=[Console]::OutputEncoding',
        command
      ].join('; ')
      executable = powershellPath()
      shellArgs = ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(prefixed, 'utf16le').toString('base64')]
    } else {
      executable = process.env.SHELL || '/bin/bash'
      shellArgs = ['-lc', command]
    }

    return await new Promise<{ output: string; isError: boolean }>((resolve, reject) => {
      const child = spawn(executable, shellArgs, {
        cwd,
        windowsHide: true,
        detached: !isWindows,
        env: {
          ...toolTempEnv(),
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          TERM: 'dumb'
        }
      })

      let output = ''
      let truncated = false
      let settled = false
      let timedOut = false
      let aborted = false
      let timer: NodeJS.Timeout | undefined

      const append = (chunk: string): void => {
        const clean = stripAnsi(chunk).replace(/\r\n/g, '\n')
        if (output.length < MAX_OUTPUT) {
          const remaining = MAX_OUTPUT - output.length
          output += clean.slice(0, remaining)
          if (clean.length > remaining) truncated = true
        } else {
          truncated = true
        }
        if (clean) context.onOutput(clean.slice(0, 10_000))
      }

      const finish = (isError: boolean): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        context.signal.removeEventListener('abort', onAbort)
        let text = output.trimEnd()
        if (!text) text = timedOut ? '' : '(命令执行完成，无输出)'
        if (timedOut) text += `\n\n命令执行超时（${Math.round(timeout / 1000)} 秒），进程已终止。`
        if (aborted) text += '\n\n命令已被用户或系统中止。'
        if (truncated) text += '\n\n…（输出过长，已截断）'
        resolve({ output: truncate(text, MAX_OUTPUT + 500), isError: isError || timedOut || aborted })
      }

      const terminate = (): void => {
        killTree(child.pid)
        setTimeout(() => finish(true), 1200)
      }

      const onAbort = (): void => {
        aborted = true
        terminate()
      }

      child.stdout?.on('data', (data: Buffer) => append(data.toString('utf8')))
      child.stderr?.on('data', (data: Buffer) => append(data.toString('utf8')))
      child.on('error', (error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        context.signal.removeEventListener('abort', onAbort)
        reject(new ToolError(`无法启动命令：${error.message}`))
      })
      child.on('close', (code) => {
        if (aborted) {
          finish(true)
          return
        }
        if (!timedOut && code !== 0 && code !== null) {
          output += `\n\n(退出码 ${code})`
        }
        finish(code !== 0)
      })

      if (context.signal.aborted) {
        onAbort()
      } else {
        context.signal.addEventListener('abort', onAbort)
        timer = setTimeout(() => {
          timedOut = true
          terminate()
        }, timeout)
      }
    })
  }
}
