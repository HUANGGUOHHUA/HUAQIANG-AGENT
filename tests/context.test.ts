import { describe, expect, it } from 'vitest'
import { prepareContext } from '../app/src/main/agent/loop'
import type { AppMessage } from '../app/src/shared/types'

function message(role: 'user' | 'assistant', content: string, index: number): AppMessage {
  return {
    id: `message-${index}`,
    role,
    content,
    createdAt: index
  }
}

describe('context compression', () => {
  it('keeps short histories intact', () => {
    const prepared = prepareContext(
      [message('user', '你好', 1), message('assistant', '你好，有什么可以帮你？', 2)],
      128000,
      8192,
      '你是编程助手'
    )
    expect(prepared.dropped).toBe(0)
    expect(prepared.summary).toBe('')
    expect(prepared.messages).toHaveLength(2)
  })

  it('compresses older turns when the model context window is small', () => {
    const messages: AppMessage[] = []
    for (let i = 0; i < 24; i += 1) {
      messages.push(message('user', `第 ${i} 轮需求：${'实现一个功能。'.repeat(120)}`, i * 2))
      messages.push(message('assistant', `第 ${i} 轮回复：${'已经完成修改。'.repeat(120)}`, i * 2 + 1))
    }

    const prepared = prepareContext(messages, 8000, 2048, '你是编程助手')
    expect(prepared.dropped).toBeGreaterThan(0)
    expect(prepared.summary).toContain('压缩摘要')
    expect(prepared.messages.length).toBeLessThan(messages.length)
    expect(prepared.messages[0].role).toBe('user')
    expect(prepared.messages[prepared.messages.length - 1].content).toContain('第 23 轮回复')
  })

  it('does not collapse a normal session when max output is close to the context window', () => {
    const prepared = prepareContext(
      [
        message('user', '请实现登录页面', 1),
        message('assistant', '已经创建 App.tsx 和样式文件。', 2)
      ],
      128000,
      128000,
      '你是编程助手'
    )
    expect(prepared.dropped).toBe(0)
    expect(prepared.messages).toHaveLength(2)
  })
})
