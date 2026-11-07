import { dialog, ipcMain } from 'electron'
import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { AttachmentPayload } from '../../shared/types'
import { readPickedAttachment } from '../attachments/files'
import { elevationLog } from '../elevation'
import { state } from '../state'

const MAX_ATTACHMENT_BATCH = 8
const MAX_ATTACHMENT_BATCH_BYTES = 48 * 1024 * 1024

/** 工作区、文件打开方式和附件读取。 */
export function registerWorkspaceIpc(): void {
  ipcMain.handle('workspace:choose', async () => {
    const win = state.mainWindow
    if (!win) return null
    const result = await dialog.showOpenDialog(win, {
      title: '选择工作区文件夹',
      defaultPath: state.settings.getRaw().workspace,
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || !result.filePaths[0]) return null
    return result.filePaths[0]
  })

  ipcMain.handle('workspace:list', (_event, path?: string) => state.workspace.list(path))
  ipcMain.handle('workspace:read', (_event, path: string) => state.workspace.read(path))
  ipcMain.handle('workspace:readAsset', (_event, path: string) => state.workspace.readAsset(path))
  ipcMain.handle('workspace:extract', (_event, path: string) => state.workspace.extract(path))
  ipcMain.handle('workspace:ocr', (_event, path: string) => state.workspace.ocr(path))
  ipcMain.handle('workspace:write', (_event, path: string, content: string) =>
    state.workspace.write(path, content)
  )

  registerOpenHandlers()
  registerAttachmentIpc()
}

async function revealInExplorer(path?: string): Promise<void> {
  elevationLog(`reveal: ${String(path)}`)
  // 主进程可能被安全软件限制拉起资源管理器，优先交给辅助进程执行。
  if (state.worker?.ready) {
    try {
      const absolute = await state.workspace.absolutePath(path)
      const result = await state.worker.executeBuiltin('system_reveal', { path: absolute })
      if (!result.isError) {
        elevationLog(`reveal ok via worker: ${absolute}`)
        return
      }
      elevationLog(`reveal worker error: ${result.output}`)
    } catch (error) {
      elevationLog(`reveal worker failed: ${String(error)}`)
    }
  }
  try {
    await state.workspace.reveal(path)
    elevationLog(`reveal ok: ${String(path)}`)
  } catch (error) {
    elevationLog(`reveal failed: ${String(path)}: ${String(error)}`)
    throw error
  }
}

function registerOpenHandlers(): void {
  ipcMain.handle('workspace:reveal', async (_event, path?: string) => {
    await revealInExplorer(path)
  })
  ipcMain.handle('workspace:openWith', async (_event, path?: string) => {
    elevationLog(`openWith: ${String(path)}`)
    try {
      await state.workspace.openWith(path)
      elevationLog(`openWith spawned: ${String(path)}`)
    } catch (error) {
      elevationLog(`openWith failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })
  ipcMain.handle('workspace:openOffice', async (_event, path?: string) => {
    elevationLog(`openOffice: ${String(path)}`)
    try {
      await state.workspace.openOffice(path)
      elevationLog(`openOffice spawned: ${String(path)}`)
    } catch (error) {
      elevationLog(`openOffice failed: ${String(path)}: ${String(error)}`)
      throw error
    }
  })
  ipcMain.handle('workspace:open', async (_event, path?: string) => {
    await state.workspace.open(path)
  })
}

function registerAttachmentIpc(): void {
  ipcMain.handle('attachments:pick', async (): Promise<AttachmentPayload[]> => {
    const options: Parameters<typeof dialog.showOpenDialog>[0] = {
      title: '选择要附加的文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '常用文件',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'txt', 'md',
            'json', 'ts', 'tsx', 'js', 'jsx', 'html', 'css', 'py', 'java', 'cs'
          ]
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    }
    const win = state.mainWindow
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    return readAttachmentPaths(result.filePaths.slice(0, MAX_ATTACHMENT_BATCH), false)
  })

  // Files dropped from Explorer (any directory). Each read is bounded by
  // readPickedAttachment (20MB cap, text/PDF truncation), batches are capped
  // at 8, and nothing is cached in the main process afterwards.
  ipcMain.handle('attachments:readPaths', async (_event, paths: unknown) => {
    if (!Array.isArray(paths)) return { attachments: [], errors: ['参数不正确'] }
    const unique = [
      ...new Set(
        paths.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      )
    ].slice(0, MAX_ATTACHMENT_BATCH)
    let totalBytes = 0
    const errors: string[] = []
    const attachments: AttachmentPayload[] = []
    for (const raw of unique) {
      try {
        const target = raw.trim()
        if (!isAbsolute(target)) throw new Error('路径必须是绝对路径')
        const info = await stat(target)
        if (!info.isFile()) throw new Error('不是文件')
        if (totalBytes + info.size > MAX_ATTACHMENT_BATCH_BYTES) {
          throw new Error('本次拖入的文件总量超过 48MB')
        }
        totalBytes += info.size
        attachments.push(await readPickedAttachment(target))
      } catch (error) {
        errors.push(`${raw}：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return { attachments, errors }
  })
}

async function readAttachmentPaths(
  filePaths: string[],
  reportErrors: boolean
): Promise<AttachmentPayload[]> {
  const attachments: AttachmentPayload[] = []
  for (const filePath of filePaths) {
    try {
      attachments.push(await readPickedAttachment(filePath))
    } catch (error) {
      if (reportErrors) console.error('Failed to read picked attachment:', error)
    }
  }
  return attachments
}
