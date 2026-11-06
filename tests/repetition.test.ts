import { describe, expect, it } from 'vitest'
import { cleanRepetition, findRepetition } from '../app/src/main/agent/repetition'

describe('repetition guard', () => {
  it('detects a repeated sentence loop', () => {
    const text = `已完成前面的步骤。${'请继续检查配置文件并确认结果。'.repeat(30)}`
    const match = findRepetition(text)
    expect(match).not.toBeNull()
    expect(cleanRepetition(text).length).toBeLessThan(text.length)
  })

  it('does not cut normal prose', () => {
    const text =
      '先读取文件，再检查配置，最后运行测试。这个流程只执行一次。' +
      '如果测试失败，先看错误信息，不要重复同一操作。'.repeat(2)
    expect(findRepetition(text)).toBeNull()
  })
})
