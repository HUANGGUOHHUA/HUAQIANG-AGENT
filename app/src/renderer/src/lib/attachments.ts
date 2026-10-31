import type { AttachmentPayload } from '../../../shared/types'

const MAX_IMAGE_EDGE = 2000
const MAX_TEXT_CHARS = 120_000

function stamp(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`
}

async function imageToDataUrl(
  file: File
): Promise<{ dataUrl: string; mime: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const shrink = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * shrink))
  const height = Math.max(1, Math.round(bitmap.height * shrink))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法处理图片')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  // Keep PNG for possible transparency/UI captures; photos compress much better as JPEG.
  const usePng = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp'
  const mime = usePng ? 'image/png' : 'image/jpeg'
  return { dataUrl: canvas.toDataURL(mime, 0.9), mime, width, height }
}

export async function fileToAttachment(file: File, index = 0): Promise<AttachmentPayload | null> {
  const name = file.name?.trim() || `粘贴内容-${stamp()}-${index + 1}`
  if (file.type.startsWith('image/')) {
    try {
      const { dataUrl, mime } = await imageToDataUrl(file)
      const ext = mime === 'image/png' ? 'png' : 'jpg'
      return {
        path: name.includes('.') ? name : `${name}.${ext}`,
        kind: 'image',
        mime,
        dataUrl,
        size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
      }
    } catch {
      return null
    }
  }
  const textLike =
    file.type.startsWith('text/') ||
    /\.(txt|md|markdown|json|jsonc|ya?ml|toml|ini|log|csv|ts|tsx|js|jsx|py|ps1|sh|html|css|xml)$/i.test(name)
  if (textLike) {
    try {
      const text = await file.text()
      return {
        path: name,
        kind: 'text',
        mime: file.type || 'text/plain',
        content: text.slice(0, MAX_TEXT_CHARS),
        size: file.size
      }
    } catch {
      return null
    }
  }
  return {
    path: name,
    kind: 'binary',
    mime: file.type || 'application/octet-stream',
    size: file.size
  }
}

/** Keep the total inline image budget bounded so large pastes/drops cannot
 *  exhaust renderer memory (data URLs are kept as UTF-16 strings). */
export const MAX_ATTACHMENT_IMAGE_CHARS = 24_000_000

export function attachmentsImageChars(items: AttachmentPayload[]): number {
  return items.reduce(
    (total, item) => total + (item.kind === 'image' && item.dataUrl ? item.dataUrl.length : 0),
    0
  )
}

/** Downscale an image attachment read from disk so it stays cheap to keep in
 *  React state and session files. Returns the original item when it is small. */
export async function shrinkImageAttachment(item: AttachmentPayload): Promise<AttachmentPayload> {
  if (item.kind !== 'image' || !item.dataUrl) return item
  try {
    const img = new Image()
    img.src = item.dataUrl
    await img.decode()
    const shrink = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
    if (shrink === 1 && item.dataUrl.length <= 4_000_000) return item
    const width = Math.max(1, Math.round(img.naturalWidth * shrink))
    const height = Math.max(1, Math.round(img.naturalHeight * shrink))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return item
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, 0, 0, width, height)
    const keepPng =
      item.mime === 'image/png' ||
      item.mime === 'image/gif' ||
      item.mime === 'image/webp' ||
      item.mime === 'image/svg+xml'
    const mime = keepPng ? 'image/png' : 'image/jpeg'
    const dataUrl = canvas.toDataURL(mime, 0.9)
    return {
      ...item,
      mime,
      dataUrl,
      size: Math.round((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75)
    }
  } catch {
    return item
  }
}

export async function filesToAttachments(files: File[]): Promise<AttachmentPayload[]> {
  const seen = new Set<string>()
  const unique = files.filter((file) => {
    // Clipboard and drop events can expose the same file through several
    // channels, and `File` objects are distinct instances each time.
    const key = `${file.name}|${file.size}|${file.lastModified}|${file.type}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const results = await Promise.all(unique.map((file, index) => fileToAttachment(file, index)))
  return results.filter((item): item is AttachmentPayload => Boolean(item))
}
