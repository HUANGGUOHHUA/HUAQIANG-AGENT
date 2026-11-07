import { readFile, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import type { AttachmentPayload } from '../../shared/types'
import { extractPdfText } from './pdf'
import { ocrImage } from './ocr'
import { mimeFor } from '../mime'

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 120_000
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?)$/i

/**
 * 把一个真实文件读成模型可用的附件：图片转 data URL 并附 OCR，
 * PDF 抽文本，二进制只保留元信息，文本按上限截断。
 */
export async function readPickedAttachment(filePath: string): Promise<AttachmentPayload> {
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error('不是文件')
  if (info.size > MAX_ATTACHMENT_BYTES) throw new Error('文件超过 20MB 限制')
  const mime = mimeFor(filePath).split(';')[0]
  if (IMAGE_RE.test(filePath)) {
    const buffer = await readFile(filePath)
    const ocrText = await ocrImage(filePath).catch(() => '')
    return {
      path: filePath,
      kind: 'image',
      mime,
      size: info.size,
      dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
      ocrText: ocrText || undefined
    }
  }
  if (extname(filePath).toLowerCase() === '.pdf') {
    const buffer = await readFile(filePath)
    const text = extractPdfText(buffer)
    return text.trim()
      ? {
          path: filePath,
          kind: 'text',
          mime: 'application/pdf',
          size: info.size,
          content: `--- PDF 提取文本：${filePath} ---\n${text.slice(0, MAX_TEXT_CHARS)}`
        }
      : { path: filePath, kind: 'binary', mime: 'application/pdf', size: info.size }
  }
  const buffer = await readFile(filePath)
  if (buffer.subarray(0, 8_000).includes(0)) {
    return { path: filePath, kind: 'binary', mime, size: info.size }
  }
  return {
    path: filePath,
    kind: 'text',
    mime,
    size: info.size,
    content: buffer.toString('utf8').slice(0, MAX_TEXT_CHARS)
  }
}
