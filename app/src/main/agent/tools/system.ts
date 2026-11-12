import os from 'node:os'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ToolDefinition } from './types'
import { ToolError, stringArg, truncate } from './types'

const MAX_BODY_BYTES = 5 * 1024 * 1024
const MAX_REDIRECTS = 5

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (raw, hex: string) => {
      const code = parseInt(hex, 16)
      return code <= 0x10ffff ? String.fromCodePoint(code) : raw
    })
    .replace(/&#(\d+);/g, (raw, dec: string) => {
      const code = parseInt(dec, 10)
      return code <= 0x10ffff ? String.fromCodePoint(code) : raw
    })
}

function htmlToText(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = titleMatch ? decodeEntities(titleMatch[1]).replace(/\s+/g, ' ').trim() : ''
  const text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|header|footer|li|h[1-6]|tr|table|main)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, ' ')
  return {
    title,
    text: decodeEntities(text)
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }
}

/** Private, loopback and link-local addresses must not be reachable by the model. */
export function isBlockedAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '')
  if (value === '::' || value === '::1' || value === '0.0.0.0') return true
  if (value.startsWith('::ffff:')) return isBlockedAddress(value.slice(7))
  if (value.startsWith('fe80:') || value.startsWith('fc') || value.startsWith('fd')) return true
  if (isIP(value) !== 4) return false
  const parts = value.split('.').map(Number)
  const [a, b] = parts
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return true
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolError('仅支持 http/https 链接')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!host || /^(localhost|.*\.local|.*\.internal)$/i.test(host)) {
    throw new ToolError('不允许访问本机或内网地址')
  }
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new ToolError('不允许访问本机或内网地址')
    return
  }
  const addresses = await lookup(host, { all: true }).catch(() => [])
  if (!addresses.length) throw new ToolError(`无法解析域名：${host}`)
  if (addresses.some((item) => isBlockedAddress(item.address))) {
    throw new ToolError('不允许访问本机或内网地址')
  }
}

async function fetchPublic(url: URL, signal: AbortSignal): Promise<Response> {
  let current = url
  for (let redirects = 0; redirects < MAX_REDIRECTS; redirects++) {
    await assertPublicUrl(current)
    const response = await fetch(current, {
      signal,
      redirect: 'manual',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HuaqiangAgent/1.0',
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.5'
      }
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      await response.body?.cancel().catch(() => undefined)
      if (!location) return response
      current = new URL(location, current)
      continue
    }
    return response
  }
  throw new ToolError('重定向次数过多')
}

async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (total + value.length >= limit) {
        chunks.push(value.subarray(0, limit - total))
        await reader.cancel().catch(() => undefined)
        break
      }
      chunks.push(value)
      total += value.length
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

export const systemInfoTool: ToolDefinition = {
  name: 'get_system_info',
  displayName: '系统信息',
  risk: 'read',
  description: '获取当前电脑的操作系统、CPU、内存、运行时版本和工作区路径，用于判断环境。',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  summarize: () => '读取系统信息',
  execute: async (_args, context) => {
    const cpus = os.cpus()
    const total = os.totalmem()
    const free = os.freemem()
    const info = {
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      hostname: os.hostname(),
      cpu: cpus.length ? `${cpus[0].model} × ${cpus.length}` : 'unknown',
      memory: `${(total / 1024 ** 3).toFixed(1)} GB（可用 ${(free / 1024 ** 3).toFixed(1)} GB）`,
      uptime: `${(os.uptime() / 3600).toFixed(1)} 小时`,
      versions: {
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome
      },
      workspace: context.workspace
    }
    return { output: JSON.stringify(info, null, 2) }
  }
}

export const webFetchTool: ToolDefinition = {
  name: 'web_fetch',
  displayName: '访问网页',
  risk: 'network',
  description:
    '抓取一个 http/https 网页并转换为纯文本，用于查阅文档、资料或报错信息。只读取公开内容，不提交任何数据。',
  inputSchema: {
    type: 'object',
    properties: { url: { type: 'string', description: '完整的 http/https URL' } },
    required: ['url'],
    additionalProperties: false
  },
  summarize: (args) => `访问 ${stringArg(args, 'url').slice(0, 120) || '?'}`,
  execute: async (args, context) => {
    const input = stringArg(args, 'url', { required: true, max: 4000 }).trim()
    let url: URL
    try {
      url = new URL(input)
    } catch {
      throw new ToolError('URL 格式不正确')
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw new ToolError('仅支持 http/https 链接')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25_000)
    const onAbort = (): void => controller.abort()
    context.signal.addEventListener('abort', onAbort)
    try {
      // Validate the first hop before any request is sent, then every redirect.
      await assertPublicUrl(url)
      const response = await fetchPublic(url, controller.signal)
      const contentType = (response.headers.get('content-type') || '').toLowerCase()
      if (contentType.includes('application/pdf') || contentType.startsWith('image/')) {
        await response.body?.cancel().catch(() => undefined)
        throw new ToolError(`暂不支持直接解析该类型内容（${contentType}）`)
      }
      const raw = await readLimitedText(response, MAX_BODY_BYTES)
      let body = raw
      let title = ''
      if (contentType.includes('text/html') || raw.trimStart().startsWith('<')) {
        const parsed = htmlToText(raw)
        title = parsed.title
        body = parsed.text
      } else if (contentType.includes('json')) {
        try {
          body = JSON.stringify(JSON.parse(raw), null, 2)
        } catch {
          body = raw
        }
      }
      body = truncate(body, 60_000)
      const header = [
        `URL: ${response.url}`,
        `状态: HTTP ${response.status}${response.ok ? '' : '（请求失败）'}`,
        title ? `标题: ${title}` : '',
        ''
      ]
        .filter(Boolean)
        .join('\n')
      return { output: `${header}${body}`, isError: !response.ok }
    } catch (error) {
      if (error instanceof ToolError) throw error
      if (controller.signal.aborted && !context.signal.aborted) {
        throw new ToolError('请求超时（25 秒）')
      }
      if (context.signal.aborted) throw new ToolError('请求已中止')
      throw new ToolError(`网络请求失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      clearTimeout(timer)
      context.signal.removeEventListener('abort', onAbort)
    }
  }
}