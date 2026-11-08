import { describe, expect, it } from 'vitest'
import { nearestLines } from '../app/src/main/agent/tools/desktop/session'

const lines = [
  { text: '张村', x: 674, y: 797, width: 41, height: 22 },
  { text: '张柯', x: 100, y: 200, width: 40, height: 20 },
  { text: '332316332：[图片]', x: 0, y: 0, width: 100, height: 20 },
  { text: '教研室', x: 10, y: 40, width: 60, height: 20 }
]

describe('nearest OCR lines', () => {
  it('suggests one-character OCR mistakes', () => {
    const near = nearestLines(lines, '张柯')
    expect(near.map((line) => line.text)).toEqual(['张村'])
  })

  it('does not suggest unrelated text', () => {
    expect(nearestLines(lines, '发送').map((line) => line.text)).toEqual([])
  })

  it('ignores the exact match and empty input', () => {
    expect(nearestLines([{ text: '张柯' }], '张柯')).toEqual([])
    expect(nearestLines(lines, '')).toEqual([])
  })

  it('caps the number of suggestions', () => {
    const many = Array.from({ length: 10 }, (_, index) => ({ text: `张${index}` }))
    expect(nearestLines(many, '张柯', 3)).toHaveLength(3)
  })
})
