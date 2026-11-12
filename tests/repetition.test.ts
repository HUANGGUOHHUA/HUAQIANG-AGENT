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

  it('does not cut legitimate non-contiguous repeats', () => {
    const sentence = '检查配置并运行测试。'
    const filler =
      '这里是正常的长段落内容，用于拉开重复之间的距离，并补充更多背景信息和实现细节，确保文本足够长。'
    const text = sentence + filler + sentence + filler + sentence + filler
    expect(findRepetition(text)).toBeNull()
  })
})
