import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { normalizeOcrText, ocrImage, ocrImageBoxes } from '../app/src/main/attachments/ocr'

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

  it('returns OCR line boxes for direct click targeting', async () => {
    const fixture = fileURLToPath(new URL('./fixtures/ocr.png', import.meta.url))
    const boxes = await ocrImageBoxes(fixture)
    expect(boxes.width).toBeGreaterThan(0)
    expect(boxes.height).toBeGreaterThan(0)
    expect(boxes.lines.length).toBeGreaterThan(0)
    expect(boxes.lines.every((line) => line.width > 0 && line.height > 0)).toBe(true)
    expect(boxes.lines.map((line) => line.text).join(' ')).toContain('OCR')
  }, 60_000)
})
