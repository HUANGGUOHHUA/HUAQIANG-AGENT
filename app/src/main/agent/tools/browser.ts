import type { BrowserWindow } from 'electron'
import type { BrowserBridge } from '../../browser-bridge'
import type { ToolDefinition } from './types'
import { ToolError, boolArg, numberArg, stringArg } from './types'

function normalizeUrl(input: string): string {
  let candidate = input.trim()
  if (!candidate) throw new ToolError('url 不能为空')
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`
  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new ToolError('URL 格式不正确')
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new ToolError('仅支持 http/https 链接')
  return url.toString()
}

export function createBrowserTools(
  bridge: BrowserBridge,
  getWindow: () => BrowserWindow | null
): ToolDefinition[] {
  const run = async (
    action: 'open' | 'snapshot' | 'click' | 'type' | 'scroll' | 'back' | 'reload',
    params: Record<string, unknown>
  ): Promise<{ output: string }> => {
    try {
      const data = await bridge.command(getWindow(), action, params)
      return { output: typeof data === 'string' ? data : JSON.stringify(data ?? { ok: true }, null, 2) }
    } catch (error) {
      throw new ToolError(error instanceof Error ? error.message : String(error))
    }
  }

  return [
    {
      name: 'browser_open',
      displayName: '打开网页',
      risk: 'network',
      description:
        '在内置浏览器中打开一个网址。参数 url：要访问的网址，只支持 http/https，省略协议时自动补 https://。返回打开后的网址和标题。需要先用它打开页面，才能用其他浏览器工具。',
      inputSchema: {
        type: 'object',
        properties: { url: { type: 'string', description: '要打开的网址，例如 https://example.com' } },
        required: ['url'],
        additionalProperties: false
      },
      summarize: (args) => `打开 ${stringArg(args, 'url').slice(0, 120) || '?'}`,
      execute: async (args) => {
        const url = normalizeUrl(stringArg(args, 'url', { required: true, max: 4000 }))
        return run('open', { url })
      }
    },
    {
      name: 'browser_snapshot',
      displayName: '查看页面',
      risk: 'read',
      description:
        '读取内置浏览器当前页面的内容。返回页面的网址、标题、正文文本，以及可点击/可输入元素的编号列表。之后用 browser_click 或 browser_type 时，参数 index 就填这里的编号。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      summarize: () => '读取当前页面内容',
      execute: async () => run('snapshot', {})
    },
    {
      name: 'browser_click',
      displayName: '点击元素',
      risk: 'network',
      description:
        '点击内置浏览器页面中的一个元素。参数 index：browser_snapshot 返回的元素编号。点击后建议再用 browser_snapshot 查看新页面。',
      inputSchema: {
        type: 'object',
        properties: { index: { type: 'number', description: 'browser_snapshot 返回的元素编号' } },
        required: ['index'],
        additionalProperties: false
      },
      summarize: (args) => `点击元素 #${numberArg(args, 'index', -1, 0, 9999)}`,
      execute: async (args) => {
        const index = numberArg(args, 'index', -1, 0, 9999)
        if (index < 0) throw new ToolError('参数 index 必须是元素编号（数字）')
        return run('click', { index })
      }
    },
    {
      name: 'browser_type',
      displayName: '输入文本',
      risk: 'network',
      description:
        '在内置浏览器页面的输入框中输入文字。参数 index：browser_snapshot 返回的输入框编号；text：要输入的文字；submit：可选，填 true 表示输入后按回车提交（例如搜索框）。',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'browser_snapshot 返回的输入框编号' },
          text: { type: 'string', description: '要输入的文字' },
          submit: { type: 'boolean', description: '为 true 时输入后按回车提交' }
        },
        required: ['index', 'text'],
        additionalProperties: false
      },
      summarize: (args) => `向 #${numberArg(args, 'index', -1, 0, 9999)} 输入文本`,
      execute: async (args) => {
        const index = numberArg(args, 'index', -1, 0, 9999)
        if (index < 0) throw new ToolError('参数 index 必须是元素编号（数字）')
        const text = stringArg(args, 'text', { required: true, max: 2000 })
        return run('type', { index, text, submit: boolArg(args, 'submit') })
      }
    },
    {
      name: 'browser_scroll',
      displayName: '滚动页面',
      risk: 'read',
      description:
        '滚动内置浏览器当前页面。参数 direction：填 "down" 向下滚动一屏，填 "up" 向上滚动一屏。',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'], description: '滚动方向：up 或 down' }
        },
        required: ['direction'],
        additionalProperties: false
      },
      summarize: (args) => `滚动页面（${stringArg(args, 'direction', { fallback: 'down' })}）`,
      execute: async (args) => {
        const direction = stringArg(args, 'direction', { required: true })
        if (direction !== 'up' && direction !== 'down') {
          throw new ToolError('参数 direction 只能是 up 或 down')
        }
        return run('scroll', { direction })
      }
    },
    {
      name: 'browser_back',
      displayName: '后退',
      risk: 'read',
      description: '让内置浏览器返回上一个页面，类似浏览器的后退按钮。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      summarize: () => '返回上一个页面',
      execute: async () => run('back', {})
    }
  ]
}

const APP_ACTIONS = ['open-panel', 'close-panel', 'show-tab', 'open-settings'] as const
const APP_PANEL_TABS = ['files', 'mcp', 'web'] as const
const APP_SETTINGS_TABS = ['model', 'mcp', 'workspace', 'about'] as const

export function createAppControlTool(
  bridge: BrowserBridge,
  getWindow: () => BrowserWindow | null
): ToolDefinition {
  return {
    name: 'app_control',
    displayName: '控制界面',
    risk: 'read',
    description:
      '控制应用界面。参数 action：open-panel 打开右侧面板；close-panel 收起右侧面板；show-tab 切换右侧面板标签（配合参数 tab：files 文件、mcp MCP、web 网页）；open-settings 打开设置页（可配合参数 settingsTab：model 模型、mcp MCP、workspace 工作区、about 关于）。',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [...APP_ACTIONS],
          description: '要执行的界面操作：open-panel / close-panel / show-tab / open-settings'
        },
        tab: {
          type: 'string',
          enum: [...APP_PANEL_TABS],
          description: '右侧面板标签，仅 show-tab 使用：files / mcp / web'
        },
        settingsTab: {
          type: 'string',
          enum: [...APP_SETTINGS_TABS],
          description: '设置页标签，仅 open-settings 使用：model / mcp / workspace / about'
        }
      },
      required: ['action'],
      additionalProperties: false
    },
    summarize: (args) => {
      const action = stringArg(args, 'action')
      const names: Record<string, string> = {
        'open-panel': '打开右侧面板',
        'close-panel': '收起右侧面板',
        'show-tab': `切换面板标签 ${stringArg(args, 'tab') || '?'}`,
        'open-settings': '打开设置页'
      }
      return names[action] ?? '控制界面'
    },
    execute: async (args) => {
      const action = stringArg(args, 'action', { required: true })
      if (!(APP_ACTIONS as readonly string[]).includes(action)) {
        throw new ToolError(`参数 action 只能是 ${APP_ACTIONS.join(' / ')}`)
      }
      const tab = stringArg(args, 'tab')
      const settingsTab = stringArg(args, 'settingsTab')
      if (tab && !(APP_PANEL_TABS as readonly string[]).includes(tab)) {
        throw new ToolError(`参数 tab 只能是 ${APP_PANEL_TABS.join(' / ')}`)
      }
      if (settingsTab && !(APP_SETTINGS_TABS as readonly string[]).includes(settingsTab)) {
        throw new ToolError(`参数 settingsTab 只能是 ${APP_SETTINGS_TABS.join(' / ')}`)
      }
      try {
        const data = await bridge.command(getWindow(), action, { tab, settingsTab })
        return { output: typeof data === 'string' ? data : JSON.stringify(data ?? { ok: true }, null, 2) }
      } catch (error) {
        throw new ToolError(error instanceof Error ? error.message : String(error))
      }
    }
  }
}
