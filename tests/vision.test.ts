import { describe, expect, it } from 'vitest'
import {
  knownVisionForModel,
  prepareAttachmentsForModel
} from '../app/src/main/agent/vision'

describe('vision capability handling', () => {
  it('detects known text-only and vision models', () => {
    expect(knownVisionForModel('deepseek-chat')).toBe(false)
    expect(knownVisionForModel('gpt-4o')).toBe(true)
    expect(knownVisionForModel('claude-sonnet-4')).toBe(true)
    expect(knownVisionForModel('unknown-model')).toBeUndefined()
  })

  it('strips image payloads for text-only models and adds a warning', () => {
    const result = prepareAttachmentsForModel(
      [
        { path: 'shot.png', kind: 'image', dataUrl: 'data:image/png;base64,AAAA' },
        { path: 'notes.txt', kind: 'text', content: 'hello' }
      ],
      undefined,
      'deepseek-chat'
    )
    expect(result.warning).toContain('不支持图片输入')
    expect(result.attachments[0].kind).toBe('binary')
    expect(result.attachments[0].dataUrl).toBeUndefined()
    expect(result.attachments[1].kind).toBe('text')
  })

  it('uses OCR text instead of binary when it is available', () => {
    const result = prepareAttachmentsForModel(
      [
        {
          path: 'shot.png',
          kind: 'image',
          dataUrl: 'data:image/png;base64,AAAA',
          ocrText: '登录按钮'
        }
      ],
      false,
      'deepseek-chat'
    )
    expect(result.warning).toContain('OCR')
    expect(result.attachments[0].kind).toBe('text')
    expect(result.attachments[0].content).toContain('登录按钮')
    expect(result.attachments[0].dataUrl).toBeUndefined()
  })

  it('keeps images when the model is explicitly vision-capable', () => {
    const result = prepareAttachmentsForModel(
      [{ path: 'shot.png', kind: 'image', dataUrl: 'data:image/png;base64,AAAA' }],
      true,
      'deepseek-chat'
    )
    expect(result.warning).toBeUndefined()
    expect(result.attachments[0].kind).toBe('image')
    expect(result.attachments[0].dataUrl).toBe('data:image/png;base64,AAAA')
  })
})
