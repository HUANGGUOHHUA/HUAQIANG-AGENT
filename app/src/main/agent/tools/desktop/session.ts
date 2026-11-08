import { unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import { normalizeOcrText, ocrImageBoxes } from '../../../attachments/ocr'
import { detectRapidOcr } from '../../../attachments/rapidocr'
import { ToolError, numberArg, stringArg } from '../types'
import { POST_MOUSE_DELAY_MS, runPowerShell, waitFor } from './powershell'
import {
  CLIPBOARD_PASTE_SCRIPT,
  CLIPBOARD_TEXT_SCRIPT,
  FOREGROUND_SCRIPT,
  KEYBOARD_SCRIPT,
  MOUSE_SCRIPT,
  SCREEN_SCRIPT,
  WINDOW_FOCUS_SCRIPT
} from './scripts'
import type { ScreenBounds } from './visual'

const SCREEN_SETTLE_MS = 300
const SCREEN_TIMEOUT = 20_000
const MOUSE_TIMEOUT = 12_000
const DRAG_TIMEOUT = 15_000
const KEYBOARD_TIMEOUT = 20_000

/** 一个可见窗口的屏幕矩形。 */
export interface WindowBounds {
  title: string
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenCapture {
  path: string
  bounds: ScreenBounds
  /** 截图瞬间的前台窗口；未请求或系统没有前台窗口时为空。 */
  foreground?: WindowBounds | null
  /** 恢复被隐藏的窗口与覆盖层；可重复调用。 */
  restore: () => void
}

/** 只保留中心点落在窗口矩形内的文字行。 */
export function linesInWindow<T extends { x: number; y: number; width: number; height: number }>(
  lines: T[],
  win: { x: number; y: number; width: number; height: number }
): T[] {
  return lines.filter((line) => {
    const cx = line.x + line.width / 2
    const cy = line.y + line.height / 2
    return cx >= win.x && cx <= win.x + win.width && cy >= win.y && cy <= win.y + win.height
  })
}

/** 解析脚本输出的 `title|x,y,width,height`；标题里允许出现竖线。 */
export function parseWindowLine(raw: string): WindowBounds | null {
  const bar = raw.lastIndexOf('|')
  if (bar <= 0) return null
  const parts = raw
    .slice(bar + 1)
    .split(',')
    .map((value) => Number(value))
  if (parts.length !== 4) return null
  const [x, y, width, height] = parts
  if (![x, y, width, height].every((value) => Number.isFinite(value))) return null
  return { title: raw.slice(0, bar).trim(), x, y, width, height }
}

function editDistance(a: string, b: string): number {
  if (!a.length) return b.length
  if (!b.length) return a.length
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return previous[b.length]
}

/**
 * 找不到目标文字时，找出相近的行（OCR 常把「柯」认成「村」）。
 * 只用于提示，不会自动点击，避免点错人。
 */
export function nearestLines<T extends { text: string }>(
  lines: T[],
  wanted: string,
  limit = 5
): T[] {
  const target = wanted.replace(/\s+/g, '').toLowerCase()
  if (!target) return []
  const maxDistance = Math.max(1, Math.floor(target.length / 2))
  return lines
    .map((line) => ({
      line,
      distance: editDistance(line.text.replace(/\s+/g, '').toLowerCase(), target)
    }))
    .filter((item) => item.distance > 0 && item.distance <= maxDistance)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map((item) => item.line)
}

export interface OcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrResult {
  width: number
  height: number
  engine: 'rapidocr' | 'windows'
  region?: ScreenBounds
  lines: OcrLine[]
}

export interface HighlightTarget {
  x: number
  y: number
  width?: number
  height?: number
  label?: string
}

export interface DesktopToolOptions {
  suspendOverlay?: () => void
  resumeOverlay?: () => void
  highlight?: (target: HighlightTarget) => void
  pythonPath?: () => string
  analyzeImage?: (
    question: string,
    image: { dataUrl: string; url?: string; title?: string }
  ) => Promise<string>
}

export interface ClickOptions {
  signal: AbortSignal
  button?: 'left' | 'right' | 'middle'
  clicks?: number
  durationMs?: number
  label?: string
  width?: number
  height?: number
}

/** 把任意输入收敛成脚本认识的鼠标按键。 */
export function normalizeButton(value: unknown): 'left' | 'right' | 'middle' {
  return value === 'right' || value === 'middle' ? value : 'left'
}

/** 组鼠标脚本参数，统一裁剪到安全范围。 */
function mouseArgs(action: string, args: Record<string, unknown>): string[] {
  return [
    '-Action', action,
    '-X', String(numberArg(args, 'x', 0, -100_000, 100_000)),
    '-Y', String(numberArg(args, 'y', 0, -100_000, 100_000)),
    '-X2', String(numberArg(args, 'to_x', 0, -100_000, 100_000)),
    '-Y2', String(numberArg(args, 'to_y', 0, -100_000, 100_000)),
    '-Button', stringArg(args, 'button', { fallback: 'left' }).toLowerCase(),
    '-Clicks', String(numberArg(args, 'clicks', 1, 1, 3)),
    '-Amount', String(numberArg(args, 'amount', 0, -20, 20)),
    '-Duration', String(numberArg(args, 'duration_ms', 320, 80, 1500))
  ]
}

function parseBounds(raw: string): ScreenBounds {
  const [x, y, width, height] = raw.split(',').map((value) => Number(value))
  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) ? width : 0,
    height: Number.isFinite(height) ? height : 0
  }
}

/**
 * 一次桌面任务的状态：截图、OCR 和所有输入动作。
 * 工具定义只描述参数，真正的系统调用都收敛到这里，避免每个工具重复
 * “高亮 → 执行 → 等待 → 失效缓存”的样板代码。
 */
/**
 * 接管期间被藏起来的主窗口。桌面操作全程保持隐藏，避免遮挡目标、
 * 抢焦点或把目标窗口压到别的窗口下面；运行结束时统一恢复。
 */
let hiddenWindow: { win: BrowserWindow; wasVisible: boolean } | null = null

/** 桌面任务结束后把主窗口放回来（不抢焦点）。 */
export function restoreDesktopWindow(): void {
  const hidden = hiddenWindow
  hiddenWindow = null
  if (hidden && hidden.wasVisible && !hidden.win.isDestroyed()) {
    hidden.win.showInactive()
  }
}

export class DesktopSession {
  private rapidUnavailable = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly options: DesktopToolOptions
  ) {}

  /**
   * 把自己藏起来，避免挡住目标窗口或抢走焦点。
   * 整个桌面任务期间保持隐藏，直到 restoreDesktopWindow() 才显示。
   */
  private async hideApp(suspendOverlay: boolean): Promise<() => void> {
    if (suspendOverlay) this.options.suspendOverlay?.()
    const win = this.getWindow()
    if (win && !win.isDestroyed() && win.isVisible()) {
      hiddenWindow = { win, wasVisible: true }
      win.hide()
    }
    return () => {
      if (suspendOverlay) this.options.resumeOverlay?.()
    }
  }

  private isOwnWindow(win: { title: string }): boolean {
    return win.title.includes('华强以太')
  }

  /** 输入动作期间保持自己的窗口隐藏，避免点击或按键打到本程序上。 */
  private async whileHidden<T>(run: () => Promise<T>): Promise<T> {
    const restore = await this.hideApp(false)
    try {
      return await run()
    } finally {
      restore()
    }
  }

  async capture(holdApp = false, withForeground = false): Promise<ScreenCapture> {
    const restore = await this.hideApp(true)
    try {
      await new Promise((resolve) => setTimeout(resolve, SCREEN_SETTLE_MS))
      // 隐藏自己的窗口后，前台就是用户真正在用的那个程序。
      let foreground = withForeground ? await this.foregroundWindow().catch(() => null) : null
      if (withForeground && (!foreground || this.isOwnWindow(foreground))) {
        // 刚隐藏时系统可能还没来得及切换前台，稍等再读一次。
        await new Promise((resolve) => setTimeout(resolve, 200))
        foreground = await this.foregroundWindow().catch(() => null)
        if (foreground && this.isOwnWindow(foreground)) foreground = null
      }
      const path = join(tmpdir(), `huaqiang-screen-${Date.now()}.png`)
      const raw = await runPowerShell('desktop-screen', SCREEN_SCRIPT, ['-Path', path], SCREEN_TIMEOUT)
      return { path, bounds: parseBounds(raw), foreground, restore }
    } finally {
      if (!holdApp) restore()
    }
  }

  /** 截图瞬间的前台窗口，用来把 OCR 限定在用户正在看的窗口里。 */
  async foregroundWindow(): Promise<WindowBounds | null> {
    const raw = await runPowerShell('desktop-foreground', FOREGROUND_SCRIPT, [], 8_000)
    return raw && raw !== 'none' ? parseWindowLine(raw) : null
  }

  /** 按标题包含匹配把窗口切到前台，返回它切换后的矩形。 */
  async focusWindow(title: string): Promise<WindowBounds | null> {
    const raw = await runPowerShell(
      'desktop-focus',
      WINDOW_FOCUS_SCRIPT,
      ['-Title', title],
      DRAG_TIMEOUT
    )
    if (!raw || raw === 'notfound') return null
    return parseWindowLine(raw)
  }

  /** 识别截图文字；RapidOCR 不可用时自动降级到 Windows OCR。 */
  async ocr(
    path: string,
    opts: { useRapid?: boolean; region?: ScreenBounds } = {}
  ): Promise<OcrResult> {
    if (opts.useRapid && !this.rapidUnavailable) {
      try {
        const result = await detectRapidOcr(
          path,
          this.options.pythonPath?.() || 'python.exe',
          45_000,
          opts.region
        )
        if (result.lines.length) {
          return {
            width: result.width,
            height: result.height,
            engine: 'rapidocr',
            region: opts.region,
            lines: result.lines.map((line) => ({
              text: normalizeOcrText(line.text),
              x: line.x,
              y: line.y,
              width: line.width,
              height: line.height
            }))
          }
        }
      } catch {
        // Keep Windows OCR as a working fallback when RapidOCR is not bundled.
        this.rapidUnavailable = true
      }
    }
    const result = await ocrImageBoxes(path)
    return { ...result, engine: 'windows', region: undefined }
  }

  /** 在当前前台窗口里找文字并点击中心；找不到时给出相近文字和坐标。 */
  async clickText(text: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
    // 必须保持自己的窗口隐藏：截图后立刻恢复会挡住目标，点击就会打到本程序。
    const shot = await this.capture(true, true)
    try {
      const ocr = await this.ocr(shot.path, { useRapid: true })
      const absolute = ocr.lines.map((line) => ({
        ...line,
        x: shot.bounds.x + line.x,
        y: shot.bounds.y + line.y
      }))
      // 只看前台窗口，避免点到桌面图标或另一块屏上的同名文字。
      const pool = shot.foreground ? linesInWindow(absolute, shot.foreground) : absolute
      const normalize = (value: string): string => value.replace(/\s+/g, '').toLowerCase()
      const wanted = normalize(text)
      const line = pool.find((entry) => normalize(entry.text).includes(wanted))
      if (!line) {
        const near = nearestLines(pool, text)
        if (near.length) {
          throw new ToolError(
            `没有找到文字「${text}」。相近文字：${near
              .map(
                (entry) =>
                  `「${entry.text}」(${Math.round(entry.x + entry.width / 2)}, ${Math.round(entry.y + entry.height / 2)})`
              )
              .join('、')}。确认目标后可以按坐标点击，或用 screen_click_target 按描述点击。`
          )
        }
        const sample = pool
          .slice(0, 10)
          .map((item) => item.text)
          .join('、')
        throw new ToolError(
          `没有找到文字「${text}」${sample ? `。当前窗口文字：${sample}` : ''}`
        )
      }
      const x = Math.round(line.x + line.width / 2)
      const y = Math.round(line.y + line.height / 2)
      this.options.highlight?.({ x, y, width: line.width, height: line.height, label: line.text })
      await this.whileHidden(() =>
        runPowerShell(
          'desktop-mouse',
          MOUSE_SCRIPT,
          mouseArgs('click', { ...args, x, y }),
          MOUSE_TIMEOUT
        )
      )
      await waitFor(POST_MOUSE_DELAY_MS, signal)
      return `已通过屏幕文字点击「${line.text}」中心 (${x}, ${y})`
    } finally {
      shot.restore()
      await unlink(shot.path).catch(() => undefined)
    }
  }

  async click(x: number, y: number, options: ClickOptions): Promise<void> {
    const button = options.button ?? 'left'
    const clicks = options.clicks ?? 1
    this.options.highlight?.({
      x,
      y,
      width: options.width,
      height: options.height,
      label: options.label ?? `点击 (${x}, ${y})`
    })
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('click', { x, y, button, clicks, duration_ms: options.durationMs }),
        MOUSE_TIMEOUT
      )
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async move(x: number, y: number, options: { signal: AbortSignal; durationMs?: number }): Promise<void> {
    this.options.highlight?.({ x, y, label: '鼠标移动' })
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('move', { x, y, duration_ms: options.durationMs }),
        MOUSE_TIMEOUT
      )
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async drag(
    x: number,
    y: number,
    toX: number,
    toY: number,
    options: { signal: AbortSignal; durationMs?: number; label?: string }
  ): Promise<void> {
    this.options.highlight?.({ x, y, label: options.label ?? '拖拽起点' })
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('drag', { x, y, to_x: toX, to_y: toY, duration_ms: options.durationMs }),
        DRAG_TIMEOUT
      )
    )
    await waitFor(POST_MOUSE_DELAY_MS, options.signal)
  }

  async scroll(amount: number, point?: { x: number; y: number }, signal?: AbortSignal): Promise<void> {
    if (point) {
      this.options.highlight?.({
        x: point.x,
        y: point.y,
        label: `滚轮 ${amount > 0 ? '↑' : '↓'} ${Math.abs(amount)}`
      })
    }
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-mouse',
        MOUSE_SCRIPT,
        mouseArgs('scroll', { amount, x: point?.x, y: point?.y }),
        MOUSE_TIMEOUT
      )
    )
    if (signal) await waitFor(POST_MOUSE_DELAY_MS, signal)
  }

  /** 输入文字；SendInput 被安全软件拦截时脚本会自动改用剪贴板粘贴。 */
  async typeText(text: string): Promise<'sendinput' | 'clipboard'> {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    const mode = await this.whileHidden(() =>
      runPowerShell(
        'desktop-keyboard',
        KEYBOARD_SCRIPT,
        ['-Action', 'type', '-EncodedText', encoded],
        KEYBOARD_TIMEOUT
      )
    )
    return mode === 'clipboard' ? 'clipboard' : 'sendinput'
  }

  async pressKeys(keys: string): Promise<void> {
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-keyboard',
        KEYBOARD_SCRIPT,
        ['-Action', 'press', '-Keys', keys],
        MOUSE_TIMEOUT
      )
    )
  }

  async pasteText(text: string): Promise<void> {
    const encoded = Buffer.from(text, 'utf8').toString('base64')
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-clipboard-text',
        CLIPBOARD_TEXT_SCRIPT,
        ['-EncodedText', encoded, '-WaitMs', '600'],
        DRAG_TIMEOUT
      )
    )
  }

  async pasteFiles(paths: string[]): Promise<void> {
    const encoded = Buffer.from(JSON.stringify(paths), 'utf8').toString('base64')
    await this.whileHidden(() =>
      runPowerShell(
        'desktop-clipboard',
        CLIPBOARD_PASTE_SCRIPT,
        ['-EncodedPaths', encoded, '-WaitMs', '900'],
        20_000
      )
    )
  }
}
