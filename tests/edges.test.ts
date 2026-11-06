import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { detectEdges } from '../app/src/main/attachments/edges'

const PYTHON = 'D:\\desk\\github_hq\\output\\win-unpacked\\resources\\runtime\\python\\python.exe'

describe('local edge detection', () => {
  it('finds a rectangular control border', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hq-edges-'))
    const image = join(dir, 'edges.png')
    try {
      execFileSync(PYTHON, [
        '-c',
        [
          'from PIL import Image, ImageDraw',
          `img = Image.new("RGB", (640, 360), "white")`,
          'd = ImageDraw.Draw(img)',
          'd.rectangle((120, 90, 360, 180), outline="black", width=3)',
          'd.rectangle((420, 220, 560, 300), outline="black", width=3)',
          `img.save(${JSON.stringify(image)})`
        ].join('\n')
      ])
      const result = await detectEdges(image, {
        pythonPath: PYTHON,
        minWidth: 40,
        minHeight: 30,
        maxBoxes: 20
      })
      expect(result.width).toBe(640)
      expect(result.boxes.length).toBeGreaterThan(0)
      expect(
        result.boxes.some(
          (box) =>
            Math.abs(box.x - 120) < 8 &&
            Math.abs(box.y - 90) < 8 &&
            Math.abs(box.width - 240) < 12 &&
            Math.abs(box.height - 90) < 12
        )
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60_000)
})
