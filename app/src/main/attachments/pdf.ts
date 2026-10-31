import { inflateRawSync, inflateSync } from 'node:zlib'

const MAX_TEXT = 200_000

function decodeLiteral(raw: string): string {
  let result = ''
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index]
    if (char !== '\\') {
      result += char
      continue
    }
    index += 1
    const next = raw[index]
    if (next === undefined) break
    if (next === 'n') result += '\n'
    else if (next === 'r') result += '\r'
    else if (next === 't') result += '\t'
    else if (next === 'b') result += '\b'
    else if (next === 'f') result += '\f'
    else if (next === '(' || next === ')' || next === '\\') result += next
    else if (next === '\n' || next === '\r') {
      if (next === '\r' && raw[index + 1] === '\n') index += 1
    } else if (/[0-7]/.test(next)) {
      let octal = next
      for (let count = 0; count < 2 && /[0-7]/.test(raw[index + 1] ?? ''); count += 1) {
        index += 1
        octal += raw[index]
      }
      result += String.fromCharCode(Number.parseInt(octal, 8))
    } else {
      result += next
    }
  }
  return result
}

function decodeHex(raw: string): string {
  const clean = raw.replace(/[^0-9a-fA-F]/g, '')
  if (!clean) return ''
  const bytes = Buffer.from(clean.length % 2 ? `${clean}0` : clean, 'hex')
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const body = bytes.subarray(2)
    const swapped = Buffer.alloc(body.length)
    for (let index = 0; index + 1 < body.length; index += 2) {
      swapped[index] = body[index + 1]
      swapped[index + 1] = body[index]
    }
    return swapped.toString('utf16le')
  }
  return bytes.toString('latin1')
}

function textFromContent(content: string): string {
  const pieces: string[] = []
  const pattern = /(\((?:\\.|[^\\()])*\))\s*(?:Tj|'|")|<([0-9a-fA-F\s]+)>\s*Tj/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(content))) {
    if (match[2] !== undefined) {
      const decoded = decodeHex(match[2])
      if (decoded.trim()) pieces.push(decoded)
      continue
    }
    const raw = match[1].slice(1, -1)
    const decoded = decodeLiteral(raw)
    if (decoded.trim()) pieces.push(decoded)
  }
  // Text shown through TJ arrays: [(Hello) -20 (world)] TJ
  const arrayPattern = /\[((?:\((?:\\.|[^\\()])*\)\s*|[-+]?\d+(?:\.\d+)?\s*)+)\]\s*TJ/g
  while ((match = arrayPattern.exec(content))) {
    const array = match[1]
    const stringPattern = /\((?:\\.|[^\\()])*\)/g
    let part: RegExpExecArray | null
    const parts: string[] = []
    while ((part = stringPattern.exec(array))) {
      const raw = part[0].slice(1, -1)
      const decoded = decodeLiteral(raw)
      if (decoded.trim()) parts.push(decoded)
    }
    if (parts.length) pieces.push(parts.join(''))
  }
  return pieces.join('\n')
}

function streamTexts(buffer: Buffer): string[] {
  const raw = buffer.toString('latin1')
  const texts: string[] = []
  const pattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(raw))) {
    if (texts.join('').length > MAX_TEXT) break
    const chunk = Buffer.from(match[1], 'latin1')
    let decoded = ''
    try {
      decoded = inflateSync(chunk).toString('latin1')
    } catch {
      try {
        decoded = inflateRawSync(chunk).toString('latin1')
      } catch {
        decoded = match[1]
      }
    }
    const text = textFromContent(decoded)
    if (text.trim()) texts.push(text)
  }
  return texts
}

/** Extract plain text from common PDFs using text operators and FlateDecode streams. */
export function extractPdfText(buffer: Buffer): string {
  if (buffer.length < 5 || buffer.subarray(0, 4).toString('latin1') !== '%PDF') {
    throw new Error('不是有效的 PDF 文件')
  }
  const text = streamTexts(buffer).join('\n\n').replace(/\u0000/g, '').trim()
  return text.slice(0, MAX_TEXT)
}
