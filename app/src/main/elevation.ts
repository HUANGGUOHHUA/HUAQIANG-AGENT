import { app, dialog, shell } from 'electron'
import { execFile, execFileSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, normalize } from 'node:path'

/** 提权重启时附加的命令行标记，用来避免无限重启循环。 */
export const ELEVATED_FLAG = '--hq-elevated'

export function elevationLog(line: string): void {
  try {
    const file = join(app.getPath('userData'), 'elevation.log')
    appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // Logging must never break startup.
  }
}

function elevationMarker(): string {
  return join(app.getPath('userData'), '.elevation-attempt')
}

export function hadRecentElevationAttempt(): boolean {
  try {
    return Date.now() - statSync(elevationMarker()).mtimeMs < 90_000
  } catch {
    return false
  }
}

function markElevationAttempt(): void {
  try {
    writeFileSync(elevationMarker(), String(Date.now()))
  } catch {
    // Ignore; the argv flag still guards against loops.
  }
}

export function clearElevationMarker(): void {
  try {
    unlinkSync(elevationMarker())
  } catch {
    // Nothing to clear.
  }
}

function readyMarker(): string {
  return join(app.getPath('userData'), '.elevated-ready')
}

export function clearReadyMarker(): void {
  try {
    unlinkSync(readyMarker())
  } catch {
    // Nothing to clear.
  }
}

export function markReady(): void {
  try {
    writeFileSync(readyMarker(), String(Date.now()))
  } catch {
    // The handshake is best-effort.
  }
}

/** 等待提权重启出来的新实例接管单实例锁；成功后清掉标记。 */
export async function waitForElevatedInstance(
  timeoutMs = 20_000,
  stepMs = 250
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, stepMs))
    if (existsSync(readyMarker())) {
      clearReadyMarker()
      return true
    }
  }
  return false
}

/** `whoami /groups` 结果只取一次：完整性级别和是否提权都从它推导。 */
let groupsOutput: string | null = null

function whoamiGroups(): string {
  if (groupsOutput !== null) return groupsOutput
  try {
    groupsOutput = execFileSync('whoami', ['/groups'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 3000
    })
  } catch {
    groupsOutput = ''
  }
return groupsOutput || ''
}

export function integrityLevel(): 'low' | 'medium' | 'high' | 'unknown' {
  if (process.platform !== 'win32') return 'unknown'
  const output = whoamiGroups()
  if (!output) return 'unknown'
  // S-1-16-4096 = Low, 8192 = Medium, 12288/16384 = High/System
  if (/S-1-16-4096\b/.test(output)) return 'low'
  if (/S-1-16-12288|S-1-16-16384/.test(output)) return 'high'
  return 'medium'
}

export function isElevated(): boolean {
  if (process.platform !== 'win32') return true
  // `net session` depends on the Server service and can fail even when elevated.
  // The mandatory label SID is language-independent and reliable.
  return /S-1-16-12288|S-1-16-16384/.test(whoamiGroups())
}

export async function canWriteDirectory(dir: string): Promise<boolean> {
  const probe = join(dir, `.hq-access-${process.pid}-${Date.now()}.tmp`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(probe, 'ok', 'utf8')
    await unlink(probe)
    return true
  } catch {
    return false
  }
}

export async function relaunchElevated(): Promise<boolean> {
  const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`
  const projectRoot = app.getAppPath()
  const devLauncher = join(projectRoot, '启动开发版.bat')
  let command: string
  if (!app.isPackaged && existsSync(devLauncher)) {
    // Restarting electron.exe alone would leave the electron-vite dev server
    // behind, so the new window loads nothing. Elevate the project launcher.
    command = [
      'try {',
      `Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c',${quote(`"${devLauncher}"`)})`,
      `-WorkingDirectory ${quote(projectRoot)}`,
      '-Verb RunAs -ErrorAction Stop',
      '} catch { exit 1 }'
    ].join(' ')
  } else {
    const args = process.argv.slice(1).filter((arg) => arg !== ELEVATED_FLAG)
    args.push(ELEVATED_FLAG)
    command = [
      'try {',
      `Start-Process -FilePath ${quote(process.execPath)}`,
      `-ArgumentList @(${args.map(quote).join(',')})`,
      `-WorkingDirectory ${quote(app.isPackaged ? dirname(process.execPath) : projectRoot)}`,
      '-Verb RunAs -ErrorAction Stop',
      '} catch { exit 1 }'
    ].join(' ')
  }
  markElevationAttempt()
  elevationLog(`relaunch: ${command}`)
  try {
    // Resolves when the UAC prompt is answered; non-zero means the user declined.
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        'powershell.exe',
        ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', command],
        { encoding: 'utf8', windowsHide: true, timeout: 60_000 },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(String(stdout ?? ''))
        }
      )
    })
    elevationLog(`relaunch spawned ok: ${output.trim().slice(0, 300)}`)
    return true
  } catch (error) {
    elevationLog(`relaunch failed/declined: ${String(error).slice(0, 500)}`)
    console.error('Elevation request failed or was declined:', error)
    return false
  }
}

export function openSecurityCenter(): void {
  const candidates = [
    'C:\\Program Files (x86)\\Huorong\\Sysdiag\\bin\\HipsMain.exe',
    'C:\\Program Files\\Huorong\\Sysdiag\\bin\\HipsMain.exe'
  ]
  const target = candidates.find((item) => existsSync(item))
  if (target) {
    void shell.openPath(target)
    return
  }
  void shell.openPath('C:\\Program Files (x86)\\Huorong\\Sysdiag\\bin')
}

/**
 * 确认目录可写；不可写时给出具体的排查/提权选项。
 * 返回值表示启动是否应该继续。
 */
export async function ensureWritableOrElevate(target: string, label: string): Promise<boolean> {
  if (await canWriteDirectory(target)) return true
  const alreadyTried =
    process.argv.includes(ELEVATED_FLAG) ||
    process.env.HQ_ELEVATED === '1' ||
    hadRecentElevationAttempt()
  const elevated = isElevated()
  if (!elevated && !alreadyTried) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: '需要写入权限',
      message: `${label}当前不可写`,
      detail:
        `目标：${target}\n\n` +
        '最常见的原因：火绒 / Windows Defender 的「文档保护（受控文件夹访问）」不信任本程序。\n' +
        'Kimi Code 等正式软件能直接写入，是因为它们已被安全软件放行（签名 / 信任区）。\n\n' +
        '推荐做法：打开安全软件，把工作区目录或本程序加入信任区 —— 一次配置，之后无需管理员权限，也保留拖拽功能。\n' +
        '「以管理员身份重启」通常无法绕过安全软件，且会失去拖拽功能。',
      buttons: ['打开火绒设置', '以管理员身份重启', '继续以普通权限运行'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    })
    if (choice === 0) {
      openSecurityCenter()
      return true
    }
    if (choice === 1 && (await relaunchElevated())) {
      app.quit()
      return false
    }
    return true
  }
  if (alreadyTried) {
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      title: elevated ? '写入权限受限' : '仍未获得管理员权限',
      message: elevated
        ? `即使以管理员身份运行，仍无法写入${label}`
        : `未能提升权限，${label}当前不可写`,
      detail:
        `目标：${target}\n\n` +
        (elevated
          ? '这不是 NTFS 权限问题，而是火绒 / Windows Defender 的「文档保护」按进程拦截。\n'
          : '你取消了 UAC 授权，或系统策略禁止提权。\n') +
        '可以把工作区换到非系统盘（如 D:\\华强以太项目），或打开安全软件把工作区目录 / HuaqiangAgent / electron.exe 加入信任区。',
      buttons: ['打开火绒设置', '知道了'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    if (choice === 0) openSecurityCenter()
  }
  return true
}

/** 在当前工作区不可写时，找一个非系统盘上的备用目录。 */
export function findAlternativeWorkspace(current: string): string | null {
  for (const drive of ['D', 'E', 'F', 'G']) {
    const root = `${drive}:\\`
    if (!existsSync(root)) continue
    const candidate = join(root, '华强以太项目')
    if (normalize(candidate).toLowerCase() === normalize(current).toLowerCase()) continue
    try {
      mkdirSync(candidate, { recursive: true })
      return candidate
    } catch {
      // Not writable; try the next drive.
    }
  }
  return null
}
