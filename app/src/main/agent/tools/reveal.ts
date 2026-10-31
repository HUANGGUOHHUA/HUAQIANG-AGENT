import { spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { focusExplorerWindow } from '../../explorer-focus'
import type { ToolDefinition } from './types'
import { stringArg, ToolError } from './types'

function launch(target: string, forceNewWindow: boolean): Promise<void> {
  // 和 Agent 执行命令的逻辑一致：cmd /c start。
  // 目录用 explorer.exe /e, 强制开新窗口，避免"窗口已存在所以看起来没反应"。
  const args = forceNewWindow
    ? ['/c', 'start', '', 'explorer.exe', '/e,', target]
    : ['/c', 'start', '', target]
  return new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', args, {
      windowsHide: true,
      stdio: 'ignore',
      detached: true
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`启动资源管理器失败（退出码 ${code}）`))
    })
    child.unref()
  })
}

/** 在提权辅助进程里打开资源管理器，规避主进程被安全软件拦截的问题。 */
export const revealTool: ToolDefinition = {
  name: 'system_reveal',
  displayName: '打开资源管理器',
  risk: 'read',
  description: '在工作区中打开文件夹或选中文件（内部使用）。',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要打开的绝对路径' },
      select: { type: 'boolean', description: '是否在资源管理器中选中该文件' }
    },
    required: ['path'],
    additionalProperties: false
  },
  summarize: (args) => `打开 ${stringArg(args, 'path').slice(0, 120)}`,
  execute: async (args) => {
    const target = stringArg(args, 'path', { required: true })
    if (!target) throw new ToolError('路径不能为空')
    const info = await stat(target).catch(() => null)
    const isDir = Boolean(info?.isDirectory())
    await launch(target, isDir)
    focusExplorerWindow(target)
    return { output: isDir ? 'opened in new window' : 'opened' }
  }
}
