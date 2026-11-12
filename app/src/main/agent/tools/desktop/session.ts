import { randomUUID } from 'node:crypto'
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
  CROP_SCRIPT,
  FOREGROUND_SCRIPT,
  KEYBOARD_SCRIPT,
  MOUSE_SCRIPT,
  SCREEN_SCRIPT,
  WINDOW_FOCUS_SCRIPT,
  WINDOW_RESTORE_SCRIPT
} from './scripts'
import type { ScreenBounds } from './visual'

const SCREEN_SETTLE_MS = 300
const MAX_VISUAL_EDGE = 1920
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

/** 裁剪并缩放后的视觉输入：坐标需按 scale 乘回屏幕物理像素。 */
export interface VisionCrop {
  path: string
  width: number
  height: number
  scale: number
  originX: number
  originY: number
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
interface HiddenWindowState {
  win: BrowserWindow
  wasVisible: boolean
  previousOpacity: number
  count: number
}

let hiddenWindow: HiddenWindowState | null = null

/** 支持嵌套的接管：外层和工具内的临时动作可以成对 acquire/release。 */
function acquireHiddenWindow(win: BrowserWindow): () => void {
  if (hiddenWindow && hiddenWindow.win === win && !win.isDestroyed()) {
    hiddenWindow.count += 1
  } else {
    if (hiddenWindow) restoreHiddenWindow()
    hiddenWindow = {
      win,
      wasVisible: win.isVisible(),
      previousOpacity: win.getOpacity(),
      count: 1
    }
    win.setContentProtection(true)
    win.setOpacity(0)
    win.setIgnoreMouseEvents(true)
    win.blur()
  }
  let released = false
  return () => {
    if (released) return
    released = true
    releaseHiddenWindow()
  }
}

function releaseHiddenWindow(): void {
  if (!hiddenWindow) return
  hiddenWindow.count -= 1
  if (hiddenWindow.count > 0) return
  const state = hiddenWindow
  hiddenWindow = null
  const win = state.win
  if (win.isDestroyed()) return
  win.setOpacity(state.previousOpacity)
  win.setIgnoreMouseEvents(false)
  win.setContentProtection(false)

}

function restoreHiddenWindow(): void {
  if (!hiddenWindow) return
  hiddenWindow.count = 0
  releaseHiddenWindow()
}

/** 桌面任务结束后把主窗口恢复为可见（不抢焦点）。 */
export function restoreDesktopWindow(): void {
  restoreHiddenWindow()
}

export class DesktopSession {
  private rapidUnavailable = false

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly options: DesktopToolOptions
  ) {}

  /**
   * 不隐藏、不改变窗口大小：控制期间把主窗口变透明并让鼠标穿透，
   * 同时开启内容保护，避免截图截到本程序。结束后恢复原样。
   */
  private async hideApp(suspendOverlay: boolean): Promise<() => void> {
    if (suspendOverlay) this.options.suspendOverlay?.()
    const win = this.getWindow()
    const release =
      win && !win.isDestroyed() && win.isVisible() ? acquireHiddenWindow(win) : null
    return () => {
      release?.()
      if (suspendOverlay) this.options.resumeOverlay?.()
    }
  }

  private isOwnWindow(win: { title: string }): boolean {
    return win.title.includes('华强以太')
  }

  /** 输入动作期间保持自己的窗口隐藏，避免点击或按键打到本程序上。 */
  private async whileHidden<T>(run: () => Promise<T>): Promise<T> {
    // If a capture already made the window transparent for the whole task,
    // keep it that way between actions instead of flashing it back.
    if (hiddenWindow) return run()
    const restore = await this.hideApp(false)
    try {
      return await run()
    } finally {
      restore()
    }
  }

  async capture(holdApp = false, withForeground = false): Promise<ScreenCapture> {
    const restore = await this.hideApp(true)
    let completed = false
    let overlayResumed = false
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
      const path = join(tmpdir(), `huaqiang-screen-${randomUUID()}.png`)
      const raw = await runPowerShell('desktop-screen', SCREEN_SCRIPT, ['-Path', path], SCREEN_TIMEOUT)
      completed = true
      // 截图完成后立即恢复 HUD，让用户能看到模型正在分析和执行什么。
      this.options.resumeOverlay?.()
      overlayResumed = true
      return { path, bounds: parseBounds(raw), foreground, restore }
    } finally {
      if (!overlayResumed) this.options.resumeOverlay?.()
      if (!holdApp || !completed) restore()
    }
  }

  /** 截图瞬间的前台窗口，用来把 OCR 限定在用户正在看的窗口里。 */
  async foregroundWindow(): Promise<WindowBounds | null> {
    const raw = await runPowerShell('desktop-foreground', FOREGROUND_SCRIPT, [], 8_000)
    return raw && raw !== 'none' ? parseWindowLine(raw) : null
  }

  /**
   * 从整屏截图里裁出目标窗口，只把这块图交给视觉模型。
   * 模型在窗口图里的坐标就是窗口内坐标，加回原点即可。
   */
  async cropWindow(
    source: string,
    screen: ScreenBounds,
    crop: ScreenBounds,
    maxEdge = MAX_VISUAL_EDGE
  ): Promise<VisionCrop> {
    const left = Math.max(crop.x, screen.x)
    const top = Math.max(crop.y, screen.y)
    const right = Math.min(crop.x + crop.width, screen.x + screen.width)
    const bottom = Math.min(crop.y + crop.height, screen.y + screen.height)
    const x = Math.max(0, left - screen.x)
    const y = Math.max(0, top - screen.y)
    const width = Math.max(1, right - left)
    const height = Math.max(1, bottom - top)
    const target = join(tmpdir(), `huaqiang-crop-${randomUUID()}.png`)
    const raw = await runPowerShell(
      'desktop-crop',
      CROP_SCRIPT,
      [
        '-Source', source,
        '-Target', target,
        '-X', String(x),
        '-Y', String(y),
        '-Width', String(width),
        '-Height', String(height),
        '-MaxEdge', String(maxEdge)
      ],
      15_000
    )
    const [outWidth, outHeight, scale] = raw.split(',').map(Number)
    return {
      path: target,
      width: Number.isFinite(outWidth) && outWidth > 0 ? outWidth : width,
      height: Number.isFinite(outHeight) && outHeight > 0 ? outHeight : height,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      originX: left,
      originY: top
    }
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

  /** 用命令行按进程名恢复/启动窗口（适合 QQ/微信等常驻托盘程序）。 */
  async restoreWindow(
    processName: string,
    title: string,
    launch: boolean,
    waitMs: number
  ): Promise<WindowBounds | null> {
    const args = ['-ProcessName', processName, '-WaitMs', String(waitMs)]
    if (title) args.push('-Title', title)
    if (launch) args.push('-Launch')
    const raw = await runPowerShell('desktop-restore', WINDOW_RESTORE_SCRIPT, args, DRAG_TIMEOUT)
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
    if (opts.region) {
      throw new Error('当前无法按指定区域识别：RapidOCR 不可用，请改用整屏识别或安装 RapidOCR')
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
