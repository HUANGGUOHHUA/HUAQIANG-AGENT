import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { app } from 'electron'
import { toolTempEnv } from './child-env'
import type { PythonStatus } from '../shared/types'

interface PythonCandidate {
  command: string
  args: string[]
}

interface PackageSpec {
  pip: string
  module: string
}

export const PYTHON_PACKAGES: PackageSpec[] = [
  { pip: 'openpyxl', module: 'openpyxl' },
  { pip: 'python-docx', module: 'docx' },
  { pip: 'python-pptx', module: 'pptx' },
  { pip: 'pypdf', module: 'pypdf' },
  { pip: 'reportlab', module: 'reportlab' },
  { pip: 'pandas', module: 'pandas' },
  { pip: 'numpy', module: 'numpy' },
  { pip: 'matplotlib', module: 'matplotlib' },
  { pip: 'Pillow', module: 'PIL' },
  { pip: 'requests', module: 'requests' },
  { pip: 'beautifulsoup4', module: 'bs4' },
  { pip: 'XlsxWriter', module: 'xlsxwriter' },
  { pip: 'pdfplumber', module: 'pdfplumber' }
]

function exec(
  command: string,
  args: string[],
  timeout = 30_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }))
          return
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) })
      }
    )
  })
}

export class PythonEnvironment {
  private readonly venvPath: string
  private readonly venvPython: string
  private readonly bundledPython: string
  private base: (PythonCandidate & { version: string }) | null = null
  private status: PythonStatus
  private setupPromise: Promise<PythonStatus> | null = null

  constructor() {
    this.venvPath = join(app.getPath('userData'), 'python-env')
    this.venvPython = join(this.venvPath, 'Scripts', 'python.exe')
    this.bundledPython = [
      join(process.resourcesPath, 'runtime', 'python', 'python.exe'),
      join(app.getAppPath(), 'runtime', 'python', 'python.exe'),
      join(process.resourcesPath, 'python', 'python.exe')
    ].find((candidate) => existsSync(candidate)) ?? ''
    this.status = {
      available: false,
      ready: false,
      installing: false,
      venvPath: this.bundledPython ? dirname(this.bundledPython) : this.venvPath,
      installed: [],
      missing: PYTHON_PACKAGES.map((item) => item.pip)
    }
  }

  getStatus(): PythonStatus {
    return { ...this.status, installed: [...this.status.installed], missing: [...this.status.missing] }
  }

  currentPythonPath(): string {
    return this.status.pythonPath ?? this.bundledPython ?? this.venvPython
  }

  private candidates(): PythonCandidate[] {
    const list: PythonCandidate[] = []
    if (this.bundledPython) {
      list.push({ command: this.bundledPython, args: [] })
    }
    if (process.env.HUAQIANG_PYTHON) {
      list.push({ command: process.env.HUAQIANG_PYTHON, args: [] })
    }
    list.push({ command: join(process.resourcesPath, 'python', 'python.exe'), args: [] })
    list.push({ command: join(app.getAppPath(), 'resources', 'python', 'python.exe'), args: [] })
    list.push({ command: 'python.exe', args: [] })
    list.push({ command: 'py.exe', args: ['-3'] })
    return list
  }

  private isBundled(base: PythonCandidate & { version: string }): boolean {
    return Boolean(this.bundledPython) && base.command === this.bundledPython
  }

  private targetPython(base: PythonCandidate & { version: string }): string {
    return this.isBundled(base) ? base.command : this.venvPython
  }

  private async findBase(): Promise<(PythonCandidate & { version: string }) | null> {
    if (this.base) return this.base
    for (const candidate of this.candidates()) {
      if (candidate.command.includes('\\') && !existsSync(candidate.command)) continue
      try {
        const { stdout, stderr } = await exec(candidate.command, [...candidate.args, '--version'], 15_000)
        const version = `${stdout}${stderr}`.trim().split(/\r?\n/)[0] || 'Python'
        if (/Python\s+\d/i.test(version)) {
          this.base = { ...candidate, version }
          return this.base
        }
      } catch {
        // Try the next candidate.
      }
    }
    return null
  }

  private async checkModules(python: string): Promise<string[]> {
    const modules = PYTHON_PACKAGES.map((item) => item.module)
    const script = [
      'import importlib.util, json',
      `mods = ${JSON.stringify(modules)}`,
      'print(json.dumps({m: bool(importlib.util.find_spec(m)) for m in mods}))'
    ].join('\n')
    const { stdout } = await exec(python, ['-c', script], 30_000)
    const line = stdout.trim().split(/\r?\n/).pop() ?? '{}'
    const parsed = JSON.parse(line) as Record<string, boolean>
    return PYTHON_PACKAGES.filter((item) => !parsed[item.module]).map((item) => item.pip)
  }

  async refresh(): Promise<PythonStatus> {
    if (this.status.installing) return this.getStatus()
    const base = await this.findBase()
    if (!base) {
      this.status = {
        ...this.status,
        available: false,
        ready: false,
        version: undefined,
        pythonPath: undefined,
        missing: PYTHON_PACKAGES.map((item) => item.pip),
        error: '没有找到可用的 Python 3 解释器'
      }
      return this.getStatus()
    }
    if (!this.isBundled(base) && !existsSync(this.venvPython)) {
      this.status = {
        ...this.status,
        available: true,
        ready: false,
        version: base.version,
        pythonPath: undefined,
        installed: [],
        missing: PYTHON_PACKAGES.map((item) => item.pip),
        error: undefined
      }
      return this.getStatus()
    }
    const target = this.targetPython(base)
    try {
      const missing = await this.checkModules(target)
      this.status = {
        ...this.status,
        available: true,
        ready: missing.length === 0,
        version: base.version,
        venvPath: this.isBundled(base) ? dirname(base.command) : this.venvPath,
        pythonPath: target,
        installed: PYTHON_PACKAGES.filter((item) => !missing.includes(item.pip)).map(
          (item) => item.pip
        ),
        missing,
        error: undefined
      }
    } catch (error) {
      this.status = {
        ...this.status,
        available: true,
        ready: false,
        version: base.version,
        pythonPath: target,
        error: error instanceof Error ? error.message : String(error)
      }
    }
    return this.getStatus()
  }

  setup(): Promise<PythonStatus> {
    if (this.setupPromise) return this.setupPromise
    this.setupPromise = this.doSetup().finally(() => {
      this.setupPromise = null
    })
    return this.setupPromise
  }

  private async doSetup(): Promise<PythonStatus> {
    const base = await this.findBase()
    if (!base) {
      return this.refresh()
    }
    this.status = {
      ...this.status,
      available: true,
      installing: true,
      version: base.version,
      progress: '正在创建 Python 虚拟环境…',
      error: undefined
    }
    try {
      const bundled = this.isBundled(base)
      if (!bundled && !existsSync(this.venvPython)) {
        await exec(base.command, [...base.args, '-m', 'venv', this.venvPath], 180_000)
      }
      const target = this.targetPython(base)
      this.status = {
        ...this.status,
        venvPath: bundled ? dirname(base.command) : this.venvPath,
        pythonPath: target,
        progress: '正在安装办公与数据处理库…'
      }
      await this.installPackages(target)
      this.status = { ...this.status, installing: false, progress: undefined }
      return await this.refresh()
    } catch (error) {
      this.status = {
        ...this.status,
        installing: false,
        ready: false,
        progress: undefined,
        error: error instanceof Error ? error.message : String(error)
      }
      return this.getStatus()
    }
  }

  private installPackages(python: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const specs = PYTHON_PACKAGES.map((item) => item.pip)
      const indexUrl = process.env.HUAQIANG_PIP_INDEX || 'https://pypi.tuna.tsinghua.edu.cn/simple'
      const child = spawn(
        python,
        [
          '-m',
          'pip',
          'install',
          '--disable-pip-version-check',
          '--no-input',
          '--prefer-binary',
          '--no-warn-script-location',
          '--timeout',
          '45',
          '--retries',
          '2',
          '-i',
          indexUrl,
          ...specs
        ],
        {
          windowsHide: true,
          env: {
            ...toolTempEnv(),
            PYTHONUTF8: '1',
            PIP_DISABLE_PIP_VERSION_CHECK: '1',
            PIP_NO_INPUT: '1'
          }
        }
      )
      let tail = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('Python 依赖安装超过 15 分钟'))
      }, 15 * 60_000)
      const onData = (chunk: Buffer): void => {
        tail = `${tail}${chunk.toString('utf8')}`.slice(-800)
        const line = tail.split(/\r?\n/).filter(Boolean).pop()
        if (line) this.status = { ...this.status, progress: line.slice(0, 240) }
      }
      child.stdout?.on('data', onData)
      child.stderr?.on('data', onData)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`pip 安装失败（退出码 ${code}）：${tail.slice(-500)}`))
      })
    })
  }

  async promptContext(): Promise<string> {
    const status =
      this.status.ready || this.status.installing ? this.getStatus() : await this.refresh()
    if (!status.available) return ''
    if (status.ready && status.pythonPath) {
      return [
        '[本地 Python 基础环境]',
        `- 解释器：${status.pythonPath}`,
        `- 已安装：${status.installed.join(', ')}`,
        '- 需要处理 Excel/Word/PPT/PDF、数据或图片时，优先用 run_command 调用这个解释器运行 Python 脚本。',
        '- 例如：& "' + status.pythonPath + '" script.py',
        '- 不要无必要地全局 pip install；缺少库时先说明，再安装到这个解释器。'
      ].join('\n')
    }
    return [
      '[本地 Python 基础环境]',
      `- 检测到 Python ${status.version ?? ''}，虚拟环境尚未初始化完成。`,
      status.installing ? '- 正在后台安装办公/数据依赖。' : '- 可在设置 → 工作区中初始化基础环境。'
    ].join('\n')
  }
}
