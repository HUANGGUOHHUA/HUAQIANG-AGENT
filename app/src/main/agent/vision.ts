import type { AttachmentPayload } from '../../shared/types'

/** Best-effort vision support detection for known model families. */
export function knownVisionForModel(model: string): boolean | undefined {
  const id = model.toLowerCase().trim()
  if (!id) return undefined
  if (
    /(deepseek-(chat|reasoner|coder)|kimi-for-coding|gpt-3\.5|text-embedding|whisper|tts|dall-e)/.test(
      id
    )
  ) {
    return false
  }
  if (
    /(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|o3|o4|claude-3|claude-4|claude-sonnet|claude-opus|gemini|qwen.*vl|llava|pixtral|llama.*vision|deepseek-(vl|v4)|glm-4v|vision|multimodal)/.test(
      id
    )
  ) {
    return true
  }
  return undefined
}

export interface PreparedAttachments {
  attachments: AttachmentPayload[]
  warning?: string
}

export function degradeImageAttachments(attachments: AttachmentPayload[]): AttachmentPayload[] {
  return attachments.map((item) => {
    if (item.kind !== 'image') return item
    if (item.ocrText && item.ocrText.trim()) {
      return {
        ...item,
        kind: 'text' as const,
        dataUrl: undefined,
        content: `--- 图片 OCR：${item.path} ---\n${item.ocrText.slice(0, 120_000)}`
      }
    }
    return { ...item, kind: 'binary' as const, dataUrl: undefined }
  })
}

/**
 * Remove image payloads when the selected model is known to be text-only.
 * Images with OCR text become readable text; others stay as file references.
 */
export function prepareAttachmentsForModel(
  attachments: AttachmentPayload[],
  explicitVision: boolean | undefined,
  model: string
): PreparedAttachments {
  const vision = explicitVision ?? knownVisionForModel(model)
  if (vision !== false) return { attachments }
  const images = attachments.filter((item) => item.kind === 'image')
  if (!images.length) return { attachments }
  const hasOcr = images.some((item) => item.ocrText && item.ocrText.trim())
  return {
    attachments: degradeImageAttachments(attachments),
    warning: hasOcr
      ? `当前模型 ${model || '（未命名）'} 不支持图片输入，已改用本地 OCR 文本附加。`
      : `当前模型 ${model || '（未命名）'} 不支持图片输入，图片已作为文件引用附加，未发送图片数据。`
  }
}
