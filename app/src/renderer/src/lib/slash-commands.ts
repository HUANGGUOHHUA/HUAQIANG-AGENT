import type { AppMessage } from '../../../shared/types'
import { estimateMessageTokens } from './context-usage'

export interface SlashCommandDefinition {
  name: string
  usage: string
  description: string
}

export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: 'compact',
    usage: '/compact [说明]',
    description: '压缩以上对话内容，说明用于指定要保留的重点'
  },
  {
    name: 'model',
    usage: '/model',
    description: '选择本会话使用的模型'
  },
  {
    name: 'export',
    usage: '/export',
    description: '将当前会话导出为 Markdown 日志'
  },
  {
    name: 'file',
    usage: '/file [路径]',
    description: '添加工作区文件到本轮上下文；不填路径时打开文件树'
  },
  {
    name: 'help',
    usage: '/help',
    description: '查看可用的对话指令'
  }
]

export interface ParsedSlashCommand {
  name: string
  args: string
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const match = text.trim().match(/^\/([a-zA-Z-]+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1].toLowerCase(), args: (match[2] ?? '').trim() }
}

export function filterCommands(query: string): SlashCommandDefinition[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (command) =>
      command.name.startsWith(normalized) ||
      command.usage.toLowerCase().includes(`/${normalized}`)
  )
}

export interface CompactionResult {
  summary: string
  messages: AppMessage[]
  older: AppMessage[]
  removed: number
  retainedTokens: number
  removedTokens: number
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function describeTool(message: AppMessage): string {
  const calls = message.toolCalls ?? []
  if (!calls.length) return ''
  const parts = calls.slice(0, 12).map((call) => {
    const path = textOf(call.args.path) || textOf(call.args.source)
    const target = textOf(call.args.destination)
    if (call.name === 'write_file') return `写入 ${path || '?'}`
    if (call.name === 'edit_file') return `编辑 ${path || '?'}`
    if (call.name === 'create_directory') return `新建目录 ${path || '?'}`
    if (call.name === 'delete_path') return `删除 ${path || '?'}`
    if (call.name === 'move_file') return `移动 ${path || '?'} → ${target || '?'}`
    if (path) return `${call.displayName || call.name} ${path}`
    return call.displayName || call.name
  })
  return parts.length ? `（工具：${parts.join('；')}）` : ''
}

export interface CompactOptions {
  contextWindow?: number
  maxOutputTokens?: number
  retainRatio?: number
  priorSummary?: string
  /** Manual compaction may force a split even when the recent window covers everything. */
  force?: boolean
}

export function compactMessages(
  messages: AppMessage[],
  instruction: string,
  options: CompactOptions = {}
): CompactionResult | null {
  const contextWindow = Math.max(4_000, Math.round(options.contextWindow || 128_000))
  const outputTokens = Math.max(
    256,
    Math.min(contextWindow / 2, Math.round(options.maxOutputTokens || 8_192))
  )
  const retainRatio = Math.max(0.05, Math.min(0.4, options.retainRatio ?? 0.16))
  // DeepSeek Harness keeps the newest ~16% of the input capacity verbatim
  // instead of a fixed message count; the system prompt/tools/output are not retained history.
  const retainBudget = Math.max(1_024, Math.floor((contextWindow - outputTokens) * retainRatio))
  if (messages.length < 2) return null

  let retainedTokens = 0
  let keepStart = messages.length
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const next = estimateMessageTokens(messages[index])
    if (keepStart < messages.length && retainedTokens + next > retainBudget) break
    retainedTokens += next
    keepStart = index
  }

  // Snap to a user boundary so the retained tail starts a clean turn.
  while (keepStart > 0 && messages[keepStart].role !== 'user') keepStart -= 1
  // If the only selected messages are assistant messages, look forward for the
  // next user turn instead of producing an empty or assistant-led tail.
  if (messages[keepStart]?.role !== 'user') {
    while (keepStart < messages.length && messages[keepStart].role !== 'user') keepStart += 1
  }
  if (keepStart <= 0 || keepStart >= messages.length) {
    // The normal token window says there is nothing worth dropping. A manual
    // /compact still has to do something, so keep the newest turn (or at least
    // the newest message) and summarize everything before it.
    if (!options.force || messages.length < 2) return null

    let fallbackStart = messages.length - 1
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user') {
        fallbackStart = index
        break
      }
    }
    if (fallbackStart <= 0) fallbackStart = messages.length - 1
    keepStart = fallbackStart
  }

  const older = messages.slice(0, keepStart)
  const recent = messages.slice(keepStart)
  retainedTokens = recent.reduce((total, message) => total + estimateMessageTokens(message), 0)
  const lines: string[] = []
  let chars = 0
  for (const message of older) {
    const role = message.role === 'user' ? '用户' : '助手'
    const content = message.content.replace(/\s+/g, ' ').trim().slice(0, 500)
    const tools = describeTool(message)
    const line = `${role}：${content || '（无文本）'}${tools}`
    if (chars + line.length > 12_000) break
    lines.push(line)
    chars += line.length
  }

  const requirement =
    instruction.trim() ||
    '保留代码改动、关键技术决策、报错与修复、未完成任务和当前工作区状态；可以丢掉寒暄和重复解释。'
  const summary = [
    'This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it.',
    '',
    '<compacted-summary>',
    '## Primary Request and Intent',
    `- ${requirement}`,
    '## Current Work',
    `- 已压缩 ${older.length} 条较早消息，最近 ${recent.length} 条消息保留原文（约 ${retainedTokens} tokens）。`,
    ...(options.priorSummary?.trim()
      ? ['## Prior Checkpoint (merge)', options.priorSummary.trim().slice(0, 12_000)]
      : []),
    '## Conversation Facts',
    ...lines.map((line) => `- ${line}`),
    '## Next Step',
    '- Continue directly from the retained messages below.',
    '</compacted-summary>'
  ].join('\n')

  return {
    summary: summary.slice(0, 40_000),
    messages: recent,
    older,
    removed: older.length,
    retainedTokens,
    removedTokens: older.reduce((total, message) => total + estimateMessageTokens(message), 0)
  }
}

export function sessionMarkdown(input: {
  title: string
  workspace?: string
  messages: AppMessage[]
  contextSummary?: string
  contextInstruction?: string
}): string {
  const lines: string[] = [`# ${input.title}`, '']
  if (input.workspace) lines.push(`- 工作区：\`${input.workspace}\``)
  lines.push(`- 导出时间：${new Date().toLocaleString('zh-CN')}`, '')
  if (input.contextSummary) {
    lines.push('## 上下文压缩摘要', '')
    if (input.contextInstruction) lines.push(`> 压缩要求：${input.contextInstruction}`, '')
    lines.push(input.contextSummary, '')
  }
  lines.push('## 对话', '')
  for (const message of input.messages) {
    lines.push(`### ${message.role === 'user' ? '用户' : '助手'} · ${new Date(message.createdAt).toLocaleString('zh-CN')}`, '')
    if (message.content.trim()) lines.push(message.content, '')
    if (message.reasoning?.trim()) {
      lines.push('<details><summary>思考过程</summary>', '', message.reasoning, '', '</details>', '')
    }
    for (const call of message.toolCalls ?? []) {
      const path = textOf(call.args.path) || textOf(call.args.source)
      lines.push(
        `- 工具 \`${call.displayName || call.name}\` · ${call.status}${path ? ` · \`${path}\`` : ''}`
      )
    }
    if (message.toolCalls?.length) lines.push('')
    if (message.error) lines.push(`> 错误：${message.error}`, '')
  }
  return lines.join('\n')
}
