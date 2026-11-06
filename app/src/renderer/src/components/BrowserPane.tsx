import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, Copy, ExternalLink, Globe, House, LoaderCircle, Plus, RotateCw, Search, X } from 'lucide-react'
import type { BrowserCommand } from '../../../shared/types'
import { cn, uid } from '../lib/utils'

const START_PAGE =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>新标签页</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: radial-gradient(ellipse 70% 50% at 70% -10%, rgba(99,102,241,0.14), transparent 60%), #0b0f17;
    color: #e9eef7; font-family: "Inter", "Segoe UI", "Microsoft YaHei", sans-serif; }
  .card { text-align: center; max-width: 420px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 8px; font-weight: 600; letter-spacing: 0.02em; }
  p { font-size: 13px; line-height: 1.8; color: rgba(226,232,240,0.45); margin: 0 0 26px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .grid a { display: flex; flex-direction: column; align-items: center; gap: 7px; padding: 14px 8px;
    border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; background: rgba(255,255,255,0.04);
    color: #c6cfdb; text-decoration: none; font-size: 12px; transition: all .16s ease; }
  .grid a:hover { border-color: rgba(129,140,248,0.5); background: rgba(99,102,241,0.12); color: #eef2ff; transform: translateY(-1px); }
  .grid b { width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px;
    background: linear-gradient(140deg, #6366f1, #4f46e5); color: #fff; font-size: 13px; font-weight: 700; }
</style>
</head>
<body>
<div class="card">
  <h1>内嵌浏览器</h1>
  <p>在地址栏输入网址或关键词搜索，也可以让 Agent 自动打开网页、读取内容并执行操作。</p>
  <div class="grid">
    <a href="https://www.baidu.com"><b>度</b>百度</a>
    <a href="https://www.bing.com"><b>B</b>必应</a>
    <a href="https://github.com"><b>G</b>GitHub</a>
    <a href="https://www.bilibili.com"><b>哔</b>哔哩哔哩</a>
    <a href="https://www.icourse163.org"><b>慕</b>中国大学MOOC</a>
    <a href="https://developer.mozilla.org/zh-CN/"><b>M</b>MDN 文档</a>
  </div>
</div>
</body>
</html>`)

const SNAPSHOT_SCRIPT = `(() => {
  const selector = "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='menuitem'],[contenteditable='true'],[onclick]"
  document.querySelectorAll('[data-hq-idx]').forEach((el) => el.removeAttribute('data-hq-idx'))
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const style = window.getComputedStyle(el)
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
  }
  const textOf = (el) => {
    const value = 'value' in el ? String(el.value ?? '') : ''
    return (el.innerText || value || el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim()
  }
  const labelOf = (el) => {
    try {
      if (el.labels && el.labels.length) return el.labels[0].innerText || ''
    } catch (error) {}
    const labelledBy = el.getAttribute('aria-labelledby')
    if (labelledBy) {
      const target = document.getElementById(labelledBy)
      if (target) return target.innerText || ''
    }
    const parentLabel = el.closest('label')
    if (parentLabel) return parentLabel.innerText || ''
    return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || ''
  }
  const cssPath = (el) => {
    if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id)
    const parts = []
    let node = el
    while (node && node.nodeType === 1 && parts.length < 6) {
      let part = node.tagName.toLowerCase()
      const parent = node.parentElement
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName)
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const elements = []
  for (const el of document.querySelectorAll(selector)) {
    if (elements.length >= 120) break
    if (!visible(el)) continue
    const type = (el.getAttribute('type') || el.getAttribute('role') || el.tagName).toLowerCase()
    if (type === 'hidden' || el.getAttribute('aria-hidden') === 'true') continue
    const index = elements.length
    el.setAttribute('data-hq-idx', String(index))
    const rect = el.getBoundingClientRect()
    const item = {
      index,
      tag: el.tagName.toLowerCase(),
      type,
      role: el.getAttribute('role') || '',
      text: textOf(el).slice(0, 120),
      label: labelOf(el).replace(/\\s+/g, ' ').trim().slice(0, 120),
      name: el.getAttribute('name') || '',
      id: el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      autocomplete: el.getAttribute('autocomplete') || '',
      value:
        'value' in el
          ? String(el.getAttribute('type') || '').toLowerCase() === 'password'
            ? '••••••••'
            : String(el.value ?? '').slice(0, 120)
          : '',
      href: el.getAttribute('href') || '',
      disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      checked: 'checked' in el ? Boolean(el.checked) : false,
      rect: {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: Math.round(rect.left + rect.width / 2),
        centerY: Math.round(rect.top + rect.height / 2)
      },
      selector: cssPath(el).slice(0, 300)
    }
    elements.push(item)
  }
  return {
    url: location.href,
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, 6000),
    elements
  }
})()`

const CONTROL_SELECTOR =
  "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='menuitem'],[contenteditable='true'],[onclick]"

const SELECT_HELPER = `
  const pickElement = (index, selector, text, role) => {
    const all = Array.from(document.querySelectorAll(${JSON.stringify(CONTROL_SELECTOR)}))
    if (Number.isInteger(index) && index >= 0) {
      return document.querySelector('[data-hq-idx="' + index + '"]')
    }
    if (selector) {
      try {
        const bySelector = document.querySelector(selector)
        if (bySelector) return bySelector
      } catch (error) {}
    }
    const wantedText = String(text || '').replace(/\\s+/g, ' ').trim().toLowerCase()
    const wantedRole = String(role || '').trim().toLowerCase()
    if (wantedText) {
      const exact = all.find((el) => {
        const value = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase()
        return value === wantedText
      })
      if (exact) return exact
      const partial = all.find((el) => {
        const value = (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().toLowerCase()
        return value.includes(wantedText)
      })
      if (partial) return partial
    }
    if (wantedRole) {
      return all.find((el) => String(el.getAttribute('role') || el.tagName).toLowerCase() === wantedRole) || null
    }
    return null
  }
  const elementInfo = (el) => {
    const r = el.getBoundingClientRect()
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
      selector: (() => {
        if (el.id) return '#' + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id)
        const parts = []
        let node = el
        while (node && node.nodeType === 1 && parts.length < 6) {
          let part = node.tagName.toLowerCase()
          const parent = node.parentElement
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === node.tagName)
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')'
          }
          parts.unshift(part)
          node = node.parentElement
        }
        return parts.join(' > ')
      })(),
      rect: {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        centerX: Math.round(r.left + r.width / 2),
        centerY: Math.round(r.top + r.height / 2)
      }
    }
  }
  const setElementValue = (el, value) => {
    const text = String(value ?? '')
    if (el.isContentEditable) {
      el.focus()
      el.innerText = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    if (el.tagName === 'SELECT') {
      el.value = text
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    }
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set
    if (setter) setter.call(el, text)
    else el.value = text
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }
`

interface BrowserTab {
  id: string
  url: string
  title: string
  loading: boolean
}

function makeTab(title = '起始页'): BrowserTab {
  return { id: uid(), url: START_PAGE, title, loading: false }
}

function loadAndWait(view: HqWebviewElement, url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      window.clearTimeout(timer)
      view.removeEventListener('did-finish-load', onDone)
      view.removeEventListener('dom-ready', onDone)
      view.removeEventListener('did-fail-load', onFail)
    }
    const onDone = (): void => {
      cleanup()
      resolve()
    }
    const onFail = (event: Event): void => {
      cleanup()
      const detail = (event as { errorDescription?: string }).errorDescription
      reject(new Error(detail || '页面加载失败'))
    }
    const timer = window.setTimeout(() => {
      cleanup()
      reject(new Error('页面加载超时'))
    }, 10_000)
    view.addEventListener('did-finish-load', onDone)
    view.addEventListener('dom-ready', onDone)
    view.addEventListener('did-fail-load', onFail)
    void view.loadURL(url).catch((error: unknown) => {
      cleanup()
      reject(error instanceof Error ? error : new Error(String(error)))
    })
  })
}

function normalizeUrl(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ? value : `https://${value}`
}

function resolveTarget(raw: string): string {
  const value = raw.trim()
  if (!value) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value
  // 形如 example.com / example.com/path 的按网址处理，其余当关键词搜索
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?([/?#]\S*)?$/.test(value)) return `https://${value}`
  return `https://www.baidu.com/s?wd=${encodeURIComponent(value)}`
}

interface BrowserTabViewProps {
  tab: BrowserTab
  active: boolean
  onUpdate: (id: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'loading'>>) => void
  registerView: (id: string, view: HqWebviewElement | null) => void
  onReady: (id: string) => void
  onFound: (id: string, result: { active: number; total: number }) => void
}

function BrowserTabView({
  tab,
  active,
  onUpdate,
  registerView,
  onReady,
  onFound
}: BrowserTabViewProps): React.JSX.Element {
  const webviewRef = useRef<HqWebviewElement | null>(null)
  const tabId = tab.id

  useEffect(() => {
    const view = webviewRef.current
    if (!view) return
    const currentUrl = (): string => {
      try {
        return view.getURL()
      } catch {
        return ''
      }
    }
    const onReadyEvent = (): void => onReady(tabId)
    const syncUrl = (): void => onUpdate(tabId, { url: currentUrl() })
    const onStart = (): void => onUpdate(tabId, { loading: true })
    const onStop = (): void => onUpdate(tabId, { loading: false, url: currentUrl() })
    const onTitle = (event: Event): void => {
      onUpdate(tabId, { title: (event as { title?: string }).title ?? '' })
    }
    const onNewWindow = (event: Event): void => {
      const target = (event as { url?: string }).url
      if (target) void window.hq.openExternal(target).catch(() => undefined)
    }
    const onFoundInPage = (event: Event): void => {
      const detail = event as { result?: { activeMatchOrdinal?: number; matches?: number } }
      if (detail.result) {
        onFound(tabId, {
          active: detail.result.activeMatchOrdinal ?? 0,
          total: detail.result.matches ?? 0
        })
      }
    }
    view.addEventListener('dom-ready', onReadyEvent)
    view.addEventListener('did-navigate', syncUrl)
    view.addEventListener('did-navigate-in-page', syncUrl)
    view.addEventListener('did-start-loading', onStart)
    view.addEventListener('did-stop-loading', onStop)
    view.addEventListener('page-title-updated', onTitle)
    view.addEventListener('new-window', onNewWindow)
    view.addEventListener('found-in-page', onFoundInPage)
    return () => {
      view.removeEventListener('dom-ready', onReadyEvent)
      view.removeEventListener('did-navigate', syncUrl)
      view.removeEventListener('did-navigate-in-page', syncUrl)
      view.removeEventListener('did-start-loading', onStart)
      view.removeEventListener('did-stop-loading', onStop)
      view.removeEventListener('page-title-updated', onTitle)
      view.removeEventListener('new-window', onNewWindow)
      view.removeEventListener('found-in-page', onFoundInPage)
    }
  }, [tabId, onUpdate, onReady, onFound])

  return (
    <webview
      ref={(node) => {
        webviewRef.current = node as HqWebviewElement | null
        registerView(tabId, webviewRef.current)
      }}
      className={cn('browser-webview', !active && 'browser-webview-hidden')}
      style={{ flex: 1 }}
      partition="persist:hqbrowser"
      src={START_PAGE}
    />
  )
}

export default function BrowserPane(): React.JSX.Element {
  const [tabs, setTabs] = useState<BrowserTab[]>(() => [makeTab()])
  const [activeId, setActiveId] = useState(() => tabs[0]?.id ?? '')
  const [agentTabId, setAgentTabId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [findMatch, setFindMatch] = useState<{ active: number; total: number } | null>(null)

  const tabsRef = useRef(tabs)
  const activeIdRef = useRef(activeId)
  const agentTabIdRef = useRef<string | null>(null)
  const viewRefs = useRef(new Map<string, HqWebviewElement>())
  const readyRefs = useRef(new Set<string>())
  const viewWaiters = useRef(new Map<string, Array<(view: HqWebviewElement) => void>>())

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  const markAgentTab = useCallback((id: string | null): void => {
    agentTabIdRef.current = id
    setAgentTabId(id)
  }, [])

  const markReady = useCallback((id: string): void => {
    readyRefs.current.add(id)
    const waiters = viewWaiters.current.get(id)
    if (waiters) {
      viewWaiters.current.delete(id)
      const view = viewRefs.current.get(id)
      if (view) waiters.forEach((resolve) => resolve(view))
    }
  }, [])

  const probeReady = useCallback((id: string): boolean => {
    if (readyRefs.current.has(id)) return true
    const view = viewRefs.current.get(id)
    if (!view) return false
    try {
      view.getURL()
      readyRefs.current.add(id)
      return true
    } catch {
      return false
    }
  }, [])

  const registerView = useCallback(
    (id: string, view: HqWebviewElement | null): void => {
      if (view) {
        viewRefs.current.set(id, view)
        // `dom-ready` can fire before React attaches its listeners; probe a few
        // times so readiness is detected even when the event was missed.
        for (const delay of [0, 250, 800]) {
          window.setTimeout(() => {
            if (probeReady(id)) markReady(id)
          }, delay)
        }
      } else {
        viewRefs.current.delete(id)
        readyRefs.current.delete(id)
      }
    },
    [probeReady, markReady]
  )

  const waitForView = useCallback((id: string): Promise<HqWebviewElement> => {
    const existing = viewRefs.current.get(id)
    if (existing && (readyRefs.current.has(id) || probeReady(id))) return Promise.resolve(existing)
    return new Promise((resolve, reject) => {
      const waiters = viewWaiters.current.get(id) ?? []
      waiters.push(resolve)
      viewWaiters.current.set(id, waiters)
      window.setTimeout(() => {
        const list = viewWaiters.current.get(id)
        if (list) {
          viewWaiters.current.delete(id)
          list.splice(0, list.length)
        }
        reject(new Error('浏览器标签页尚未就绪'))
      }, 5_000)
    })
  }, [probeReady])

  const syncActiveNav = useCallback((id?: string): void => {
    const key = id ?? activeIdRef.current
    const view = viewRefs.current.get(key)
    if (!view || !probeReady(key)) {
      setCanGoBack(false)
      setCanGoForward(false)
      return
    }
    try {
      setCanGoBack(view.canGoBack())
      setCanGoForward(view.canGoForward())
    } catch {
      setCanGoBack(false)
      setCanGoForward(false)
    }
  }, [])

  const handleTabUpdate = useCallback(
    (id: string, patch: Partial<Pick<BrowserTab, 'url' | 'title' | 'loading'>>): void => {
      setTabs((prev) => prev.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)))
      if (id === activeIdRef.current) syncActiveNav(id)
    },
    [syncActiveNav]
  )

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]

  useEffect(() => {
    const url = activeTab?.url ?? ''
    setUrlInput(url.startsWith('data:') ? '' : url)
    syncActiveNav(activeTab?.id)
  }, [activeTab?.id, activeTab?.url, syncActiveNav])

  const addTab = useCallback((): void => {
    const tab = makeTab()
    setTabs((prev) => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  const closeTab = useCallback(
    (id: string): void => {
      const current = tabsRef.current
      const next = current.filter((tab) => tab.id !== id)
      if (agentTabIdRef.current === id) markAgentTab(null)
      if (next.length === 0) {
        const fresh = makeTab()
        setTabs([fresh])
        setActiveId(fresh.id)
        return
      }
      setTabs(next)
      if (activeIdRef.current === id) {
        const index = current.findIndex((tab) => tab.id === id)
        setActiveId(next[Math.min(Math.max(index, 0), next.length - 1)].id)
      }
    },
    [markAgentTab]
  )

  const navigate = useCallback(
    (raw: string): void => {
      const target = resolveTarget(raw)
      if (!target) return
      const tabId = activeIdRef.current
      const view = viewRefs.current.get(tabId)
      if (!view) return
      const go = (): void => {
        try {
          void view.loadURL(target).catch(() => undefined)
        } catch {
          // The webview has not finished attaching yet.
        }
      }
      if (probeReady(tabId)) {
        go()
        return
      }
      let done = false
      const onReady = (): void => {
        if (done) return
        done = true
        view.removeEventListener('dom-ready', onReady)
        go()
      }
      view.addEventListener('dom-ready', onReady)
    },
    [probeReady]
  )

  const handleCommand = useCallback(
    async (cmd: BrowserCommand): Promise<void> => {
      let tabId = agentTabIdRef.current
      if (!tabId || !tabsRef.current.some((tab) => tab.id === tabId)) {
        const tab = makeTab('AI 浏览')
        tabId = tab.id
        markAgentTab(tabId)
        setTabs((prev) => [...prev, tab])
      }
      setActiveId(tabId)
      let view: HqWebviewElement
      try {
        view = await waitForView(tabId)
      } catch (error) {
        await window.hq.browserResult({
          id: cmd.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }
      const params = cmd.params ?? {}
      try {
        switch (cmd.action) {
          case 'open': {
            const target = normalizeUrl(String(params.url ?? ''))
            if (!target) throw new Error('缺少网址')
            await loadAndWait(view, target)
            const pageTitle = await view.executeJavaScript('document.title')
            await window.hq.browserResult({
              id: cmd.id,
              ok: true,
              data: { url: view.getURL(), title: String(pageTitle ?? ''), tabId }
            })
            break
          }
          case 'snapshot': {
            const data = await view.executeJavaScript(SNAPSHOT_SCRIPT)
            await window.hq.browserResult({ id: cmd.id, ok: true, data })
            break
          }
          case 'screenshot': {
            const image = await view.capturePage()
            const size = image.getSize()
            await window.hq.browserResult({
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
              await window.hq.browserResult({
                id: cmd.id,
                ok: false,
                error: '未找到匹配的控件，请先重新获取页面快照'
              })
            } else {
              await window.hq.browserResult({ id: cmd.id, ok: true, data: result })
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
              await window.hq.browserResult({
                id: cmd.id,
                ok: false,
                error: '未找到匹配的输入控件，请先重新获取页面快照'
              })
            } else {
              await window.hq.browserResult({ id: cmd.id, ok: true, data: result })
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
  el.focus({ preventScroll: true })
  setElementValue(el, ${JSON.stringify(value)})
  return { filled: true, ...elementInfo(el) }
})()`)
            if (!result || (result as { missing?: boolean }).missing) {
              await window.hq.browserResult({
                id: cmd.id,
                ok: false,
                error: '未找到匹配的输入控件，请先重新获取页面快照'
              })
            } else {
              await window.hq.browserResult({ id: cmd.id, ok: true, data: result })
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
  const all = Array.from(document.querySelectorAll('input,textarea,select,[contenteditable="true"]')).filter((candidate) => {
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
    setElementValue(el, value)
    matched.push({ key, ...elementInfo(el) })
  }
  if (submit) {
    const form = all.find((el) => el.form)?.form
    if (form) {
      if (form.requestSubmit) form.requestSubmit()
      else form.submit()
    }
  }
  return { filled: matched.length, unmatched, matched }
})()`)
            await window.hq.browserResult({ id: cmd.id, ok: true, data: result })
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
            await window.hq.browserResult({ id: cmd.id, ok: true, data: result })
            break
          }
          case 'back': {
            view.goBack()
            await window.hq.browserResult({ id: cmd.id, ok: true, data: { url: view.getURL() } })
            break
          }
          case 'forward': {
            view.goForward()
            await window.hq.browserResult({ id: cmd.id, ok: true, data: { url: view.getURL() } })
            break
          }
          case 'stop': {
            view.stop()
            await window.hq.browserResult({ id: cmd.id, ok: true, data: { url: view.getURL() } })
            break
          }
          case 'reload': {
            view.reload()
            await window.hq.browserResult({ id: cmd.id, ok: true, data: { url: view.getURL() } })
            break
          }
          default:
            await window.hq.browserResult({
              id: cmd.id,
              ok: false,
              error: `未知的浏览器操作：${String(cmd.action)}`
            })
        }
      } catch (error) {
        await window.hq.browserResult({
          id: cmd.id,
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    },
    [markAgentTab, waitForView]
  )

  useEffect(() => {
    const unsubscribe = window.hq.onBrowserCommand?.((cmd) => void handleCommand(cmd))
    return () => unsubscribe?.()
  }, [handleCommand])

  const activeView = (): HqWebviewElement | undefined => {
    const view = viewRefs.current.get(activeId)
    return view && probeReady(activeId) ? view : undefined
  }

  const handleFound = useCallback(
    (id: string, result: { active: number; total: number }): void => {
      if (id === activeIdRef.current) setFindMatch(result)
    },
    []
  )

  const closeFind = useCallback((): void => {
    setFindOpen(false)
    setFindText('')
    setFindMatch(null)
    try {
      activeView()?.stopFindInPage('clearSelection')
    } catch {
      // webview 未就绪时忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const runFind = useCallback(
    (text: string, forward = true, findNext = false): void => {
      const view = activeView()
      if (!view) return
      try {
        if (!text) {
          view.stopFindInPage('clearSelection')
          setFindMatch(null)
          return
        }
        view.findInPage(text, { forward, findNext })
      } catch {
        // webview 未就绪时忽略
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeId]
  )

  // 切换标签页时关闭查找栏
  useEffect(() => {
    setFindOpen(false)
    setFindText('')
    setFindMatch(null)
  }, [activeId])

  const goHome = useCallback((): void => {
    const view = activeView()
    if (!view) return
    try {
      void view.loadURL(START_PAGE).catch(() => undefined)
    } catch {
      // webview 未就绪时忽略
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])

  const copyLink = useCallback((): void => {
    const url = activeTab?.url ?? ''
    if (!url || url.startsWith('data:')) return
    void navigator.clipboard.writeText(url).catch(() => undefined)
  }, [activeTab?.url])

  return (
    <div
      className="browser-pane"
      tabIndex={-1}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          setFindOpen(true)
        }
      }}
    >
      <div className="browser-tabs">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={cn(
              'browser-tab',
              tab.id === activeId && 'active',
              tab.id === agentTabId && 'agent'
            )}
            title={tab.title || tab.url}
            onClick={() => setActiveId(tab.id)}
            onAuxClick={(event) => {
              if (event.button === 1) {
                event.preventDefault()
                closeTab(tab.id)
              }
            }}
          >
            {tab.id === agentTabId && <span className="browser-tab-dot" />}
            {tab.loading && <LoaderCircle size={10} className="spin browser-tab-spin" />}
            <span className="browser-tab-title">{tab.title || '新标签页'}</span>
            <button
              type="button"
              className="browser-tab-close"
              title="关闭标签页"
              onClick={(event) => {
                event.stopPropagation()
                closeTab(tab.id)
              }}
            >
              <X size={10} />
            </button>
          </div>
        ))}
        <button type="button" className="browser-tab-add" title="新建标签页" onClick={addTab}>
          <Plus size={12} />
        </button>
      </div>
      <div className="browser-bar">
        <button type="button" onClick={goHome} title="回到起始页">
          <House size={13} />
        </button>
        <button
          type="button"
          onClick={() => activeView()?.goBack()}
          disabled={!canGoBack}
          title="后退"
        >
          <ArrowLeft size={13} />
        </button>
        <button
          type="button"
          onClick={() => activeView()?.goForward()}
          disabled={!canGoForward}
          title="前进"
        >
          <ArrowRight size={13} />
        </button>
        {activeTab?.loading ? (
          <button type="button" onClick={() => activeView()?.stop()} title="停止加载">
            <X size={13} />
          </button>
        ) : (
          <button type="button" onClick={() => activeView()?.reload()} title="刷新">
            <RotateCw size={13} />
          </button>
        )}
        <div className="browser-url-wrap">
          <Globe size={11} className="browser-url-icon" />
          <input
            className="browser-url"
            value={urlInput}
            placeholder="输入网址或搜索关键词"
            spellCheck={false}
            onChange={(event) => setUrlInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') navigate(urlInput)
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setFindOpen((value) => !value)}
          title="页面内查找"
          className={cn(findOpen && 'active')}
        >
          <Search size={13} />
        </button>
        <button
          type="button"
          onClick={copyLink}
          disabled={!activeTab || activeTab.url.startsWith('data:')}
          title="复制当前链接"
        >
          <Copy size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (activeTab) void window.hq.openExternal(activeTab.url).catch(() => undefined)
          }}
          title="在系统浏览器中打开"
        >
          <ExternalLink size={13} />
        </button>
      </div>
      {findOpen && (
        <div className="browser-find-bar">
          <Search size={12} />
          <input
            autoFocus
            value={findText}
            placeholder="在当前页面中查找"
            spellCheck={false}
            onChange={(event) => {
              setFindText(event.target.value)
              runFind(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runFind(findText, !event.shiftKey, true)
              if (event.key === 'Escape') closeFind()
            }}
          />
          <span className="browser-find-count">
            {findText ? (findMatch ? `${findMatch.active}/${findMatch.total}` : '0/0') : ''}
          </span>
          <button
            type="button"
            title="上一个"
            disabled={!findText}
            onClick={() => runFind(findText, false, true)}
          >
            <ChevronUp size={13} />
          </button>
          <button
            type="button"
            title="下一个"
            disabled={!findText}
            onClick={() => runFind(findText, true, true)}
          >
            <ChevronDown size={13} />
          </button>
          <button type="button" title="关闭查找" onClick={closeFind}>
            <X size={13} />
          </button>
        </div>
      )}
      {tabs.map((tab) => (
        <BrowserTabView
          key={tab.id}
          tab={tab}
          active={tab.id === activeId}
          onUpdate={handleTabUpdate}
          registerView={registerView}
          onReady={markReady}
          onFound={handleFound}
        />
      ))}
    </div>
  )
}
