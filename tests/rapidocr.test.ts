import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { detectRapidOcr, stopRapidOcr } from '../app/src/main/attachments/rapidocr'

const PYTHON = 'D:\\desk\\github_hq\\runtime\\python\\python.exe'

describe('RapidOCR worker', () => {
  it('loads the model and returns text with boxes', async () => {
    try {
      const fixture = fileURLToPath(new URL('./fixtures/ocr.png', import.meta.url))
      const result = await detectRapidOcr(fixture, PYTHON, 60_000)
      expect(result.lines.length).toBeGreaterThan(0)
      expect(result.lines.some((line) => line.text.includes('OCR'))).toBe(true)
      expect(result.lines.some((line) => line.text.includes('华强智码'))).toBe(true)
      expect(result.lines.every((line) => line.width > 0 && line.height > 0)).toBe(true)

      const region = await detectRapidOcr(fixture, PYTHON, 60_000, {
        x: 0,
        y: 0,
        width: 320,
        height: 120
      })
      expect(region.width).toBeGreaterThan(0)
      expect(region.lines.some((line) => line.text.includes('华强智码'))).toBe(true)
    } finally {
      stopRapidOcr()
    }
  }, 90_000)
})
