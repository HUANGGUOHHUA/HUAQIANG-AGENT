import { describe, expect, it } from 'vitest'
import {
  linesInWindow,
  parseWindowLine
} from '../app/src/main/agent/tools/desktop/session'

describe('desktop window geometry', () => {
  it('parses the focus script output', () => {
    expect(parseWindowLine('QQ|504,327,960,640')).toEqual({
      title: 'QQ',
      x: 504,
      y: 327,
      width: 960,
      height: 640
    })
  })

  it('keeps vertical bars that belong to the window title', () => {
    expect(parseWindowLine('a|b|10,20,30,40')).toMatchObject({ title: 'a|b', x: 10, width: 30 })
  })

  it('rejects empty and malformed output', () => {
    expect(parseWindowLine('none')).toBeNull()
    expect(parseWindowLine('QQ|1,2,3')).toBeNull()
    expect(parseWindowLine('QQ|1,2,3,4,5')).toBeNull()
    expect(parseWindowLine('')).toBeNull()
  })

  it('keeps only lines whose centre is inside the window', () => {
    const lines = [
      { x: 10, y: 10, width: 100, height: 20 },
      { x: 500, y: 700, width: 100, height: 20 },
      { x: 900, y: 100, width: 100, height: 20 }
    ]
    const inside = linesInWindow(lines, { x: 0, y: 0, width: 960, height: 640 })
    expect(inside).toHaveLength(2)
    expect(inside[0].x).toBe(10)
    expect(inside[1].x).toBe(900)
  })

  it('drops a line whose centre falls outside the window', () => {
    const lines = [{ x: 900, y: 100, width: 20, height: 20 }]
    expect(linesInWindow(lines, { x: 0, y: 0, width: 960, height: 640 })).toHaveLength(1)
    expect(linesInWindow(lines, { x: 0, y: 0, width: 900, height: 640 })).toHaveLength(0)
  })
})
