import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { normalizeOcrText, ocrImage } from '../app/src/main/attachments/ocr'

describe('local Windows OCR', () => {
  it('removes spaces inserted between Chinese characters', () => {
    expect(normalizeOcrText('华 强 智 码 OCR 测 试')).toBe('华强智码 OCR 测试')
    expect(normalizeOcrText('登 录 ， 用 户 名')).toBe('登录，用户名')
  })

  it('reads text from a PNG image with Windows.Media.Ocr', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/ocr.png', import.meta.url))
    const text = await ocrImage(fixture)
    expect(text).toContain('OCR')
    expect(text).toContain('华强智码')
  }, 60_000)
})
