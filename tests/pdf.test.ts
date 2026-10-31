import { describe, expect, it } from 'vitest'
import { deflateSync } from 'node:zlib'
import { extractPdfText } from '../app/src/main/attachments/pdf'

function pdfWithStream(stream: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n', 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1')
  ])
}

describe('PDF text extraction', () => {
  it('extracts text from a simple uncompressed PDF content stream', () => {
    const content = Buffer.from(
      'BT /F1 12 Tf 72 720 Td (Hello PDF) Tj 0 -16 Td [(Second) -20 (line)] TJ ET',
      'latin1'
    )
    const text = extractPdfText(pdfWithStream(content))
    expect(text).toContain('Hello PDF')
    expect(text).toContain('Secondline')
  })

  it('inflates FlateDecode content streams', () => {
    const content = deflateSync(
      Buffer.from('BT /F1 12 Tf 72 720 Td (Compressed PDF text) Tj ET', 'latin1')
    )
    const text = extractPdfText(pdfWithStream(content))
    expect(text).toContain('Compressed PDF text')
  })

  it('keeps escaped parentheses inside literal strings', () => {
    const content = Buffer.from('BT /F1 12 Tf 72 720 Td (a\\)b) Tj ET', 'latin1')
    const text = extractPdfText(pdfWithStream(content))
    expect(text).toContain('a)b')
  })

  it('rejects non-PDF buffers', () => {
    expect(() => extractPdfText(Buffer.from('not a pdf'))).toThrow('PDF')
  })
})
