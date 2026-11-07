import type { BrowserCommand, BrowserCommandResult } from '../../../shared/types'
import { SNAPSHOT_SCRIPT, SELECT_HELPER, documentTitleScript } from './browser-scripts'

/** 浏览器命令执行时需要宿主组件提供的上下文。 */
export interface BrowserCommandHost {
  /** 命令发往的标签页 id。 */
  tabId: string
  normalizeUrl: (raw: string) => string
  loadAndWait: (url: string) => Promise<void>
  /** 把结果回传给主进程。 */
  send: (result: BrowserCommandResult) => Promise<void>
}

/**
 * 执行一条来自主进程的浏览器命令。
 * 所有页面交互都通过 executeJavaScript 完成，组件只负责标签页和 webview 生命周期。
 */
export async function executeBrowserCommand(
  view: HqWebviewElement,
  cmd: BrowserCommand,
  host: BrowserCommandHost
): Promise<void> {
  const params = cmd.params ?? {}
  try {
    switch (cmd.action) {
      case 'open': {
        const target = host.normalizeUrl(String(params.url ?? ''))
        if (!target) throw new Error('缺少网址')
        await host.loadAndWait(target)
        const pageTitle = await view.executeJavaScript('document.title')
        await host.send({
          id: cmd.id,
          ok: true,
          data: { url: view.getURL(), title: String(pageTitle ?? ''), tabId: host.tabId }
        })
        break
      }
      case 'snapshot': {
        const data = await view.executeJavaScript(SNAPSHOT_SCRIPT)
        await host.send({ id: cmd.id, ok: true, data })
        break
      }
      case 'screenshot': {
        const image = await view.capturePage()
        const size = image.getSize()
        await host.send({
          id: cmd.id,
          ok: true,
          data: {
            dataUrl: image.toDataURL(),
            width: size.width,
            height: size.height,
            url: view.getURL(),
            title: await view.executeJavaScript('document.title')
          }
        })
        break
      }
      case 'document-title': {
        const selector = typeof params.selector === 'string' ? params.selector : '#title'
        const data = await view.executeJavaScript(documentTitleScript(selector))
        await host.send({ id: cmd.id, ok: true, data })
        break
      }
      case 'click': {
        const index = Number.isInteger(Number(params.index)) ? Number(params.index) : -1
        const selector = typeof params.selector === 'string' ? params.selector : ''
        const text = typeof params.text === 'string' ? params.text : ''
        const role = typeof params.role === 'string' ? params.role : ''
        const result = await view.executeJavaScript(`(() => {
  ${SELECT_HELPER}
  const el = pickElement(${JSON.stringify(index)}, ${JSON.stringify(selector)}, ${JSON.stringify(text)}, ${JSON.stringify(role)})
  if (!el) return { missing: true }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const info = elementInfo(el)
  flashElement(el, info.text || '点击')
  const rect = el.getBoundingClientRect()
  const options = {
bubbles: true, cancelable: true, view: window, button: 0,
clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
  }
  el.focus({ preventScroll: true })
  if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerdown', options))
  el.dispatchEvent(new MouseEvent('mousedown', options))
  if (window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerup', options))
  el.dispatchEvent(new MouseEvent('mouseup', options))
  el.click()
  return { clicked: true, ...info }
})()`)
        if (!result || (result as { missing?: boolean }).missing) {
          await host.send({
            id: cmd.id,
            ok: false,
            error: '未找到匹配的控件，请先重新获取页面快照'
          })
        } else {
          await host.send({ id: cmd.id, ok: true, data: result })
        }
        break
      }
      case 'type': {
        const index = Number.isInteger(Number(params.index)) ? Number(params.index) : -1
        const selector = typeof params.selector === 'string' ? params.selector : ''
        const text = typeof params.text === 'string' ? params.text : String(params.text ?? '')
        const submit = params.submit === true
        const result = await view.executeJavaScript(`(() => {
  ${SELECT_HELPER}
  const el = pickElement(${JSON.stringify(index)}, ${JSON.stringify(selector)}, '', '')
  if (!el) return { missing: true }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  flashElement(el, '输入')
  el.focus({ preventScroll: true })
  setElementValue(el, ${JSON.stringify(text)})
  if (${submit ? 'true' : 'false'}) {
el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
el.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', bubbles: true }))
if (el.form) {
  if (el.form.requestSubmit) el.form.requestSubmit()
  else el.form.submit()
}
  }
  return { typed: true, ...elementInfo(el) }
})()`)
        if (!result || (result as { missing?: boolean }).missing) {
          await host.send({
            id: cmd.id,
            ok: false,
            error: '未找到匹配的输入控件，请先重新获取页面快照'
          })
        } else {
          await host.send({ id: cmd.id, ok: true, data: result })
        }
        break
      }
      case 'fill': {
        const index = Number.isInteger(Number(params.index)) ? Number(params.index) : -1
        const selector = typeof params.selector === 'string' ? params.selector : ''
        const value = typeof params.value === 'string' ? params.value : String(params.value ?? '')
        const result = await view.executeJavaScript(`(() => {
  ${SELECT_HELPER}
  const el = pickElement(${JSON.stringify(index)}, ${JSON.stringify(selector)}, '', '')
  if (!el) return { missing: true }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  flashElement(el, '填充')
  el.focus({ preventScroll: true })
  setElementValue(el, ${JSON.stringify(value)})
  return { filled: true, ...elementInfo(el) }
})()`)
        if (!result || (result as { missing?: boolean }).missing) {
          await host.send({
            id: cmd.id,
            ok: false,
            error: '未找到匹配的输入控件，请先重新获取页面快照'
          })
        } else {
          await host.send({ id: cmd.id, ok: true, data: result })
        }
        break
      }
      case 'autofill': {
        const fields = params.fields && typeof params.fields === 'object' ? params.fields : {}
        const submit = params.submit === true
        const result = await view.executeJavaScript(`(() => {
  ${SELECT_HELPER}
  const fields = ${JSON.stringify(fields)}
  const entries = Object.entries(fields)
  const all = hqQueryAll('input,textarea,select,[contenteditable="true"]').filter((candidate) => {
const r = candidate.getBoundingClientRect()
return r.width > 0 && r.height > 0
  })
  const matched = []
  const unmatched = []
  const keyOf = (el) => {
const label = (() => {
  try { return el.labels && el.labels.length ? el.labels[0].innerText : '' } catch (error) { return '' }
})()
return [el.getAttribute('name'), el.id, el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('autocomplete'), label]
  .filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase()
  }
  for (const [key, value] of entries) {
const wanted = String(key).replace(/\\s+/g, ' ').trim().toLowerCase()
if (!wanted) continue
const el = all.find((candidate) => keyOf(candidate).includes(wanted))
if (!el) { unmatched.push(key); continue }
el.scrollIntoView({ block: 'center', inline: 'center' })
flashElement(el, key)
setElementValue(el, value)
matched.push({ key, ...elementInfo(el) })
  }
  if (${submit ? 'true' : 'false'}) {
const form = all.find((el) => el.form)?.form
if (form) {
  if (form.requestSubmit) form.requestSubmit()
  else form.submit()
}
  }
  return { filled: matched.length, unmatched, matched }
})()`)
        await host.send({ id: cmd.id, ok: true, data: result })
        break
      }
      case 'scroll': {
        const raw = Number(params.delta ?? params.amount)
        const delta = Number.isFinite(raw) && raw !== 0
          ? raw
          : params.direction === 'up'
            ? -600
            : 600
        const result = await view.executeJavaScript(`(() => {
  window.scrollBy(0, ${delta})
  return { scrollY: window.scrollY }
})()`)
        await host.send({ id: cmd.id, ok: true, data: result })
        break
      }
      case 'back': {
        view.goBack()
        await host.send({ id: cmd.id, ok: true, data: { url: view.getURL() } })
        break
      }
      case 'forward': {
        view.goForward()
        await host.send({ id: cmd.id, ok: true, data: { url: view.getURL() } })
        break
      }
      case 'stop': {
        view.stop()
        await host.send({ id: cmd.id, ok: true, data: { url: view.getURL() } })
        break
      }
      case 'reload': {
        view.reload()
        await host.send({ id: cmd.id, ok: true, data: { url: view.getURL() } })
        break
      }
      default:
        await host.send({
          id: cmd.id,
          ok: false,
          error: `未知的浏览器操作：${String(cmd.action)}`
        })
    }
  } catch (error) {
    await host.send({
      id: cmd.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}
