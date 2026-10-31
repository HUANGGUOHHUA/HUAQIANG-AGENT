import { describe, expect, it } from 'vitest'
import {
  compactMessages,
  filterCommands,
  parseSlashCommand,
  sessionMarkdown
} from '../app/src/renderer/src/lib/slash-commands'
import { collectTurnFileChanges, turnChangeTotals } from '../app/src/renderer/src/lib/turn-changes'
import { createZipBytes } from '../app/src/renderer/src/lib/zip'
import type { AppMessage, ToolCallView } from '../app/src/shared/types'

function message(role: 'user' | 'assistant', content: string, index: number): AppMessage {
  return { id: `m-${index}`, role, content, createdAt: index }
}

describe('slash commands', () => {
  it('parses command and natural-language arguments', () => {
    expect(parseSlashCommand('/compact 保留登录接口和未完成事项')).toEqual({
      name: 'compact',
      args: '保留登录接口和未完成事项'
    })
    expect(parseSlashCommand('/model')).toEqual({ name: 'model', args: '' })
    expect(parseSlashCommand('普通消息')).toBeNull()
  })

  it('filters the command palette', () => {
    expect(filterCommands('co').map((command) => command.name)).toContain('compact')
    expect(filterCommands('mo').map((command) => command.name)).toContain('model')
    expect(filterCommands('zzz')).toHaveLength(0)
  })

  it('compacts older messages using the token-based recent window', () => {
    const messages: AppMessage[] = []
    for (let i = 0; i < 8; i += 1) {
      messages.push(message('user', `第 ${i} 轮需求` + '细节'.repeat(2_500), i * 2))
      messages.push(message('assistant', `第 ${i} 轮回复` + '结果'.repeat(2_500), i * 2 + 1))
    }
    const result = compactMessages(messages, '保留接口字段和报错', {
      contextWindow: 8_000,
      maxOutputTokens: 1_024,
      priorSummary: '之前的检查点'
    })
    expect(result).not.toBeNull()
    expect(result!.removed).toBeGreaterThan(0)
    expect(result!.summary).toContain('保留接口字段和报错')
    expect(result!.summary).toContain('compacted-summary')
    expect(result!.summary).toContain('之前的检查点')
    expect(result!.messages.length).toBeLessThan(16)
    expect(result!.messages[0].role).toBe('user')
    expect(result!.retainedTokens).toBeGreaterThan(0)
  })

  it('does not compact when the recent token budget already covers everything', () => {
    const messages: AppMessage[] = []
    for (let i = 0; i < 8; i += 1) {
      messages.push(message('user', `第 ${i} 轮需求`, i * 2))
      messages.push(message('assistant', `第 ${i} 轮回复`, i * 2 + 1))
    }
    expect(compactMessages(messages, '保留接口')).toBeNull()
  })

  it('exports a session with context summary and tool paths', () => {
    const markdown = sessionMarkdown({
      title: '登录页',
      workspace: 'D:\\desk\\demo',
      contextSummary: '之前的摘要',
      contextInstruction: '保留接口',
      messages: [
        message('user', '实现登录', 1),
        {
          ...message('assistant', '已完成', 2),
          toolCalls: [
            {
              id: 'call-1',
              name: 'write_file',
              displayName: '写入文件',
              args: { path: 'src/login.ts' },
              status: 'ok'
            }
          ]
        }
      ]
    })
    expect(markdown).toContain('# 登录页')
    expect(markdown).toContain('之前的摘要')
    expect(markdown).toContain('src/login.ts')
  })
  it('creates a ZIP archive for session export', () => {
    const zip = createZipBytes('会话.md', '# 会话\n内容')
    expect(new TextDecoder().decode(zip.slice(0, 2))).toBe('PK')
    expect(new TextDecoder().decode(zip)).toContain('会话.md')
  })
})

describe('turn file changes', () => {  it('collects successful file tool calls after the last user message', () => {
    const calls: ToolCallView[] = [
      {
        id: 'call-1',
        name: 'write_file',
        displayName: '写入文件',
        args: { path: 'src/a.ts' },
        status: 'ok',
        result: '已创建 src/a.ts',
        stats: { additions: 2, deletions: 0 }
      },
      {
        id: 'call-2',
        name: 'edit_file',
        displayName: '编辑文件',
        args: { path: 'src/b.ts' },
        status: 'ok'
      },
      {
        id: 'call-3',
        name: 'delete_path',
        displayName: '删除文件',
        args: { path: 'src/c.ts' },
        status: 'error'
      },
      {
        id: 'call-4',
        name: 'edit_file',
        displayName: '编辑文件',
        args: { path: 'src/d.ts' },
        status: 'ok',
        stats: { additions: 12, deletions: 3 }
      }
    ]
    const changes = collectTurnFileChanges([
      message('user', '改文件', 1),
      { ...message('assistant', '完成', 2), toolCalls: calls }
    ])
    expect(changes).toHaveLength(3)
    expect(changes.map((change) => change.path)).toEqual(['src/a.ts', 'src/b.ts', 'src/d.ts'])
    expect(changes[0].kind).toBe('created')
    expect(turnChangeTotals(changes)).toEqual({ additions: 14, deletions: 3 })
  })
})
