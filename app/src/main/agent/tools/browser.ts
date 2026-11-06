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
  getWindow: () => BrowserWindow | null,
  isNetworkLocked: () => boolean = () => false
): ToolDefinition[] {
  const run = async (
    action:
      | 'open'
      | 'snapshot'
      | 'click'
      | 'type'
      | 'fill'
      | 'autofill'
      | 'scroll'
      | 'back'
      | 'reload',
    params: Record<string, unknown>
  ): Promise<{ output: string }> => {
    if (
      isNetworkLocked() &&
      (['open', 'click', 'type', 'back', 'reload'].includes(action) ||
        ((action === 'fill' || action === 'autofill') && params.submit === true))
    ) {
      throw new ToolError('断网锁已开启：内置浏览器禁止加载或导航网页。')
    }
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
        '本地读取内置浏览器当前页面的控件和文本。返回网址、标题、正文，以及可点击/可输入控件的编号、标签、类型、name/id、placeholder、autocomplete、当前值和可视区域坐标。browser_click / browser_type / browser_fill 使用这里的 index 或 selector。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      summarize: () => '读取当前页面内容',
      execute: async () => run('snapshot', {})
    },
    {
      name: 'browser_click',
      displayName: '点击元素',
      risk: 'network',
      description:
        '精确点击浏览器页面中的控件。可以传 index（browser_snapshot 的编号）、selector（CSS 选择器），或 text/role 按文字或角色查找；内部会滚动到控件中心、派发指针/鼠标事件并调用 click。点击后建议重新 snapshot 验证。',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'browser_snapshot 返回的控件编号，优先级最高' },
          selector: { type: 'string', description: 'CSS 选择器，例如 #submit 或 button[type=submit]' },
          text: { type: 'string', description: '按控件文字/aria-label 包含匹配' },
          role: { type: 'string', description: '按 role 匹配，例如 button、link' }
        },
        additionalProperties: false
      },
      summarize: (args) => {
        const index = numberArg(args, 'index', -1, -1, 9999)
        if (index >= 0) return `点击控件 #${index}`
        const selector = stringArg(args, 'selector').slice(0, 60)
        const text = stringArg(args, 'text').slice(0, 40)
        return `点击控件 ${selector || text || '?'}`
      },
      execute: async (args) => {
        const index = numberArg(args, 'index', -1, -1, 9999)
        const selector = stringArg(args, 'selector').slice(0, 500)
        const text = stringArg(args, 'text').slice(0, 200)
        const role = stringArg(args, 'role').slice(0, 60)
        if (index < 0 && !selector && !text && !role) {
          throw new ToolError('请提供 index、selector、text 或 role')
        }
        return run('click', { index, selector, text, role })
      }
    },
    {
      name: 'browser_type',
      displayName: '输入文本',
      risk: 'network',
      description:
        '向浏览器输入控件输入文字。可以传 index 或 selector；text 是要输入的文字；submit 为 true 时提交表单。内部使用原生 value setter 并派发 input/change，兼容 React 等受控输入。',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'browser_snapshot 返回的控件编号' },
          selector: { type: 'string', description: 'CSS 选择器，和 index 二选一' },
          text: { type: 'string', description: '要输入的文字' },
          submit: { type: 'boolean', description: '为 true 时输入后提交' }
        },
        required: ['text'],
        additionalProperties: false
      },
      summarize: (args) => `输入文本 ${stringArg(args, 'selector').slice(0, 40) || `#${numberArg(args, 'index', -1, -1, 9999)}`}`,
      execute: async (args) => {
        const index = numberArg(args, 'index', -1, -1, 9999)
        const selector = stringArg(args, 'selector').slice(0, 500)
        if (index < 0 && !selector) throw new ToolError('请提供 index 或 selector')
        const text = stringArg(args, 'text', { required: true, max: 4000 })
        return run('type', { index, selector, text, submit: boolArg(args, 'submit') })
      }
    },
    {
      name: 'browser_fill',
      displayName: '填充输入框',
      risk: 'network',
      description:
        '精确填充一个浏览器输入控件，不改动页面其他控件。传 index 或 selector 选择目标，value 为要填入的值；提交表单传 submit=true。',
      inputSchema: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'browser_snapshot 返回的控件编号' },
          selector: { type: 'string', description: 'CSS 选择器，和 index 二选一' },
          value: { type: 'string', description: '要填入的值' },
          submit: { type: 'boolean', description: '为 true 时提交所在表单' }
        },
        required: ['value'],
        additionalProperties: false
      },
      summarize: (args) => `填充 ${stringArg(args, 'selector').slice(0, 40) || `#${numberArg(args, 'index', -1, -1, 9999)}`}`,
      execute: async (args) => {
        const index = numberArg(args, 'index', -1, -1, 9999)
        const selector = stringArg(args, 'selector').slice(0, 500)
        if (index < 0 && !selector) throw new ToolError('请提供 index 或 selector')
        return run('fill', {
          index,
          selector,
          value: stringArg(args, 'value', { required: true, max: 4000 }),
          submit: boolArg(args, 'submit')
        })
      }
    },
    {
      name: 'browser_autofill',
      displayName: '自动补全表单',
      risk: 'network',
      description:
        '本地识别页面表单并按字段名/标签/placeholder/name/id/autocomplete 自动填充多个输入框。fields 是对象，例如 {"用户名":"张三","邮箱":"a@b.com"}；未匹配字段会返回。submit=true 时提交第一个匹配表单。',
      inputSchema: {
        type: 'object',
        properties: {
          fields: {
            type: 'object',
            description: '字段名到值的映射，字段名支持 label、placeholder、name、id 或 autocomplete 的包含匹配'
          },
          submit: { type: 'boolean', description: '为 true 时提交表单' }
        },
        required: ['fields'],
        additionalProperties: false
      },
      summarize: (args) => {
        const fields = args.fields && typeof args.fields === 'object' ? Object.keys(args.fields) : []
        return `自动补全 ${fields.length} 个字段`
      },
      execute: async (args) => {
        const fields =
          args.fields && typeof args.fields === 'object' && !Array.isArray(args.fields)
            ? (args.fields as Record<string, unknown>)
            : {}
        if (!Object.keys(fields).length) throw new ToolError('fields 不能为空')
        return run('autofill', { fields, submit: boolArg(args, 'submit') })
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
