import { shell } from 'electron'
import { existsSync } from 'node:fs'
import { open, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import fg from 'fast-glob'
import type { FileAsset, FileContent, FileEntry } from '../shared/types'
import { displayPath, resolveWithinRoot } from './security/paths'
import type { SettingsStore } from './settings'
import { extractPdfText } from './attachments/pdf'
import { ocrImage } from './attachments/ocr'

import { spawn } from 'node:child_process'
import { focusExplorerWindow } from './explorer-focus'

async function spawnDetached(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      detached: true,
      stdio: 'ignore'
    })
    child.once('spawn', () => resolve())
    child.once('error', reject)
    child.unref()
  })
}

/** 通过 PowerShell 的 Start-Process 拉起资源管理器。
 *  在部分安全软件环境下，主进程直接 spawn explorer.exe 会被静默拦截，
 *  而系统自带的 powershell 作为中间层可以通过。 */
async function launchExplorer(target: string, forceNewWindow = false): Promise<void> {
  const args = forceNewWindow
    ? ['/c', 'start', '', 'explorer.exe', '/e,', target]
    : ['/c', 'start', '', target]
  await new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', args, {
      windowsHide: true,
      stdio: 'ignore',
      detached: true
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        focusExplorerWindow(target)
        resolve()
      }
      else reject(new Error(`启动资源管理器失败（退出码 ${code}）`))
    })
    child.unref()
  })
}

async function findWpsExecutable(extension: string): Promise<string | null> {
  const name = {
    '.pptx': 'wpp.exe',
    '.pptm': 'wpp.exe',
    '.ppt': 'wpp.exe',
    '.docx': 'wps.exe',
    '.docm': 'wps.exe',
    '.doc': 'wps.exe',
    '.xlsx': 'et.exe',
    '.xlsm': 'et.exe',
    '.xls': 'et.exe'
  }[extension]
  if (!name) return null
  const roots = [
    process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Kingsoft', 'WPS Office') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'WPS Office') : '',
    process.env.ProgramFiles ? join(process.env.ProgramFiles, 'Kingsoft', 'WPS Office') : '',
    process.env['ProgramFiles(x86)']
      ? join(process.env['ProgramFiles(x86)'], 'Kingsoft', 'WPS Office')
      : '',
    'C:\\Program Files\\WPS Office',
    'C:\\Program Files\\Kingsoft\\WPS Office',
    'C:\\Program Files (x86)\\Kingsoft\\WPS Office'
  ].filter(Boolean)
  const matches = await fg(
    roots.map((root) => `${root.replace(/\\/g, '/')}/**/office6/${name}`),
    {
      onlyFiles: true,
      absolute: true,
      suppressErrors: true,
      deep: 6
    }
  )
  return matches[0] ?? null
}

const HIDDEN = new Set([
  '.git',
  'node_modules',
  '.npm-cache',
  '.electron-cache',
  '.electron-builder-cache',
  '.venv',
  '__pycache__',
  '.DS_Store'
])

const MAX_READ = 1024 * 1024
const MAX_ASSET = 20 * 1024 * 1024
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  pdf: 'application/pdf',
  zip: 'application/zip'
}

export class WorkspaceService {
  constructor(private settings: SettingsStore) {}

  root(): string {
    return this.settings.getRaw().workspace
  }

  async list(inputPath?: string): Promise<FileEntry[]> {
    const absolute = await resolveWithinRoot(this.root(), inputPath || '.')
    const info = await stat(absolute)
    if (!info.isDirectory()) throw new Error('不是文件夹')
    const entries = await readdir(absolute, { withFileTypes: true })
    const result: FileEntry[] = []
    for (const entry of entries) {
      if (HIDDEN.has(entry.name)) continue
      const child = join(absolute, entry.name)
      let type: 'dir' | 'file' = entry.isDirectory() ? 'dir' : 'file'
      let size: number | undefined
      if (entry.isSymbolicLink()) {
        try {
          const target = await stat(child)
          type = target.isDirectory() ? 'dir' : 'file'
          size = target.size
        } catch {
          continue
        }
      } else if (entry.isFile()) {
        try {
          size = (await stat(child)).size
        } catch {
          size = undefined
        }
      }
      result.push({ name: entry.name, path: displayPath(this.root(), child), type, size })
      if (result.length >= 500) break
    }
    return result.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
    })
  }

  async read(inputPath: string): Promise<FileContent> {
    const absolute = await resolveWithinRoot(this.root(), inputPath)
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    const size = info.size
    const length = Math.min(size, MAX_READ)
    const handle = await open(absolute, 'r')
    let buffer: Buffer
    let bytesRead = 0
    try {
      buffer = Buffer.alloc(length)
      const read = await handle.read(buffer, 0, length, 0)
      bytesRead = read.bytesRead
    } finally {
      await handle.close()
    }
    const slice = buffer.subarray(0, bytesRead)
    const binary = slice.includes(0)
    return {
      path: displayPath(this.root(), absolute),
      content: binary ? '' : slice.toString('utf8'),
      size,
      binary,
      truncated: size > MAX_READ
    }
  }

  async extract(inputPath: string): Promise<{ path: string; text: string; truncated: boolean }> {
    const absolute = await resolveWithinRoot(this.root(), inputPath)
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    if (extname(absolute).toLowerCase() !== '.pdf') {
      throw new Error('目前只支持从 PDF 提取文本')
    }
    if (info.size > MAX_ASSET) throw new Error('PDF 超过 20MB 限制')
    const buffer = await readFile(absolute)
    const text = extractPdfText(buffer)
    return {
      path: displayPath(this.root(), absolute),
      text,
      truncated: text.length >= 200_000
    }
  }

  async readAsset(inputPath: string): Promise<FileAsset> {
    const absolute = await resolveWithinRoot(this.root(), inputPath)
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    if (info.size > MAX_ASSET) throw new Error('附件超过 20MB 限制')
    const buffer = await readFile(absolute)
    const mime = MIME_BY_EXT[extname(absolute).replace('.', '').toLowerCase()] ?? 'application/octet-stream'
    return {
      path: displayPath(this.root(), absolute),
      mime,
      size: info.size,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      binary: buffer.subarray(0, 8_000).includes(0),
      truncated: false
    }
  }

  async ocr(inputPath: string): Promise<{ path: string; text: string }> {
    const absolute = await resolveWithinRoot(this.root(), inputPath)
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    if (info.size > MAX_ASSET) throw new Error('图片超过 20MB 限制')
    const text = await ocrImage(absolute)
    return { path: displayPath(this.root(), absolute), text }
  }

  async write(inputPath: string, content: string): Promise<FileContent> {    if (typeof content !== 'string') throw new Error('文件内容必须是文本')
    if (Buffer.byteLength(content, 'utf8') > 5_000_000) {
      throw new Error('文件内容超过 5MB 限制')
    }
    const absolute = await resolveWithinRoot(this.root(), inputPath)
    const info = await stat(absolute).catch(() => null)
    if (info?.isDirectory()) throw new Error('不能把目录当作文件保存')
    await writeFile(absolute, content, 'utf8')
    return {
      path: displayPath(this.root(), absolute),
      content,
      size: Buffer.byteLength(content, 'utf8'),
      binary: false,
      truncated: false
    }
  }

  async absolutePath(inputPath?: string): Promise<string> {
    return resolveWithinRoot(this.root(), inputPath || '.')
  }

  async reveal(inputPath?: string): Promise<void> {
    const absolute = await resolveWithinRoot(this.root(), inputPath || '.')
    const info = await stat(absolute)
    if (info.isDirectory()) {
      try {
        await launchExplorer(absolute, true)
        return
      } catch {
        const error = await shell.openPath(absolute)
        if (error) throw new Error(error)
        return
      }
    }
    try {
      shell.showItemInFolder(absolute)
    } catch {
      await launchExplorer(absolute)
    }
  }

  /** Windows "Open with" picker: lets the user choose Office/WPS explicitly. */
  async openWith(inputPath?: string): Promise<void> {
    const absolute = await resolveWithinRoot(this.root(), inputPath || '.')
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    await spawnDetached('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', absolute])
  }

  async open(inputPath?: string): Promise<void> {
    const absolute = await resolveWithinRoot(this.root(), inputPath || '.')
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    const error = await shell.openPath(absolute)
    if (!error) return
    await launchExplorer(absolute)
  }

  async openOffice(inputPath?: string): Promise<void> {
    const absolute = await resolveWithinRoot(this.root(), inputPath || '.')
    const info = await stat(absolute)
    if (!info.isFile()) throw new Error('不是文件')
    const extension = extname(absolute).toLowerCase()
    const executable = {
      '.pptx': 'POWERPNT.EXE',
      '.pptm': 'POWERPNT.EXE',
      '.ppt': 'POWERPNT.EXE',
      '.docx': 'WINWORD.EXE',
      '.docm': 'WINWORD.EXE',
      '.doc': 'WINWORD.EXE',
      '.xlsx': 'EXCEL.EXE',
      '.xlsm': 'EXCEL.EXE',
      '.xls': 'EXCEL.EXE'
    }[extension]
    if (!executable) {
      await this.open(inputPath)
      return
    }
    const candidates = [
      `C:\\Program Files\\Microsoft Office\\Root\\Office16\\${executable}`,
      `C:\\Program Files (x86)\\Microsoft Office\\Root\\Office16\\${executable}`,
      `C:\\Program Files\\Microsoft Office\\Office16\\${executable}`,
      `C:\\Program Files (x86)\\Microsoft Office\\Office16\\${executable}`,
      `C:\\Program Files\\Microsoft Office\\Office15\\${executable}`,
      `C:\\Program Files (x86)\\Microsoft Office\\Office15\\${executable}`
    ]
    const app = candidates.find((candidate) => existsSync(candidate)) ?? (await findWpsExecutable(extension))
    if (!app) {
      await this.open(inputPath)
      return
    }
    await spawnDetached(app, [absolute])
  }

  fileKind(path: string): string {
    return extname(path).replace('.', '').toLowerCase() || basename(path)
  }
}
