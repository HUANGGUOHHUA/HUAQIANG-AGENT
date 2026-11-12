// 注入到 webview 页面里执行的脚本。
// FRAME_HELPER 提供查询、高亮、赋值和同源 iframe 遍历，其余脚本都基于它拼接。

export const FRAME_HELPER = `
  const hqDocuments = () => {
    const docs = []
    const walk = (doc) => {
      if (!doc || docs.indexOf(doc) >= 0) return
      docs.push(doc)
      let frames = []
      try { frames = Array.from(doc.querySelectorAll('iframe,frame')) } catch (error) { frames = [] }
      for (const frame of frames) {
        try {
          const child = frame.contentDocument
          if (child) walk(child)
        } catch (error) {}
      }
    }
    walk(document)
    return docs
  }
  const hqQueryAll = (selector) => {
    const result = []
    for (const doc of hqDocuments()) {
      try { result.push(...Array.from(doc.querySelectorAll(selector))) } catch (error) {}
    }
    return result
  }
  const hqQuery = (selector) => {
    for (const doc of hqDocuments()) {
      try {
        const found = doc.querySelector(selector)
        if (found) return found
      } catch (error) {}
    }
    return null
  }
  const flashElement = (el, label) => {
    try {
      const doc = el.ownerDocument
      if (!doc || !doc.body) return
      const rect = el.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const old = doc.getElementById('hq-action-highlight')
      if (old) old.remove()
      const box = doc.createElement('div')
      box.id = 'hq-action-highlight'
      box.textContent = label || ''
      box.style.cssText = [
        'position:fixed',
        'pointer-events:none',
        'z-index:2147483647',
        'left:' + Math.max(0, rect.left - 4) + 'px',
        'top:' + Math.max(0, rect.top - 4) + 'px',
        'width:' + (rect.width + 8) + 'px',
        'height:' + (rect.height + 8) + 'px',
        'border:2px solid #fbbf24',
        'border-radius:7px',
        'background:rgba(251,191,36,.10)',
        'box-shadow:0 0 0 3px rgba(251,191,36,.18),0 0 18px rgba(251,191,36,.65)',
        'color:#451a03',
        'font:600 11px/1.3 "Microsoft YaHei","Segoe UI",sans-serif',
        'display:flex',
        'align-items:flex-start',
        'justify-content:flex-start',
        'padding:2px 4px',
        'box-sizing:border-box'
      ].join(';')
      doc.body.appendChild(box)
      setTimeout(() => { try { box.remove() } catch (error) {} }, 1100)
    } catch (error) {}
  }
`

export const SNAPSHOT_SCRIPT = `(() => {
  ${FRAME_HELPER}
  const selector = "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='menuitem'],[contenteditable='true'],[onclick]"
  hqQueryAll('[data-hq-idx]').forEach((el) => el.removeAttribute('data-hq-idx'))
  const visible = (el) => {
    const rect = el.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    const view = el.ownerDocument && el.ownerDocument.defaultView
    const style = view ? view.getComputedStyle(el) : window.getComputedStyle(el)
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
      const target = el.ownerDocument.getElementById(labelledBy)
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
  const frameOffset = (el) => {
    let x = 0
    let y = 0
    let view = el.ownerDocument && el.ownerDocument.defaultView
    while (view && view !== window) {
      let frame = null
      try { frame = view.frameElement } catch (error) { frame = null }
      if (!frame) break
      const r = frame.getBoundingClientRect()
      x += r.left
      y += r.top
      view = frame.ownerDocument && frame.ownerDocument.defaultView
    }
    return { x, y }
  }
  const elements = []
  for (const el of hqQueryAll(selector)) {
    if (elements.length >= 120) break
    if (!visible(el)) continue
    const type = (el.getAttribute('type') || el.getAttribute('role') || el.tagName).toLowerCase()
    if (type === 'hidden' || el.getAttribute('aria-hidden') === 'true') continue
    const index = elements.length
    el.setAttribute('data-hq-idx', String(index))
    const rect = el.getBoundingClientRect()
    const offset = frameOffset(el)
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
      frame: (() => {
        try {
          const frame = el.ownerDocument.defaultView && el.ownerDocument.defaultView.frameElement
          return frame ? frame.id || frame.getAttribute('src') || 'iframe' : ''
        } catch (error) { return '' }
      })(),
      rect: {
        x: Math.round(offset.x + rect.left),
        y: Math.round(offset.y + rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        centerX: Math.round(offset.x + rect.left + rect.width / 2),
        centerY: Math.round(offset.y + rect.top + rect.height / 2)
      },
      selector: cssPath(el).slice(0, 300)
    }
    elements.push(item)
  }
  return {
    url: location.href,
    title: document.title,
    text: hqDocuments()
      .map((doc) => (doc.body ? doc.body.innerText : ''))
      .join('\\n')
      .slice(0, 6000),
    elements
  }
})()`

const CONTROL_SELECTOR =
  "a,button,input,textarea,select,summary,[role='button'],[role='link'],[role='textbox'],[role='checkbox'],[role='menuitem'],[contenteditable='true'],[onclick]"

export const SELECT_HELPER = `
  ${FRAME_HELPER}
  const frameOffset = (el) => {
    let x = 0
    let y = 0
    let view = el.ownerDocument && el.ownerDocument.defaultView
    while (view && view !== window) {
      let frame = null
      try { frame = view.frameElement } catch (error) { frame = null }
      if (!frame) break
      const r = frame.getBoundingClientRect()
      x += r.left
      y += r.top
      view = frame.ownerDocument && frame.ownerDocument.defaultView
    }
    return { x, y }
  }
  const pickElement = (index, selector, text, role) => {
    const all = hqQueryAll(${JSON.stringify(CONTROL_SELECTOR)})
    if (Number.isInteger(index) && index >= 0) {
      const byIndex = hqQuery('[data-hq-idx="' + index + '"]')
      if (byIndex) return byIndex
    }
    if (selector) {
      try {
        const bySelector = hqQuery(selector)
        if (bySelector) return bySelector
      } catch (error) {}
    }
    const wantedText = String(text || '').replace(/\\s+/g, ' ').trim().toLowerCase()
    const wantedRole = String(role || '').trim().toLowerCase()
    const labelText = (el) => {
      const labels = (() => { try { return el.labels && el.labels.length ? el.labels[0].innerText : '' } catch (error) { return '' } })()
      return [
        el.innerText, el.value, el.getAttribute('aria-label'), el.getAttribute('title'),
        el.getAttribute('placeholder'), el.getAttribute('name'), labels
      ].filter(Boolean).join(' ').replace(/\\s+/g, ' ').trim().toLowerCase()
    }
    if (wantedText) {
      const exact = all.find((el) => labelText(el) === wantedText)
      if (exact) return exact
      const partial = all.find((el) => labelText(el).includes(wantedText))
      if (partial) return partial
    }
    if (wantedRole) {
      return all.find((el) => String(el.getAttribute('role') || el.tagName).toLowerCase() === wantedRole) || null
    }
    return null
  }
  const elementInfo = (el) => {
    const r = el.getBoundingClientRect()
    const offset = frameOffset(el)
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
        x: Math.round(offset.x + r.left),
        y: Math.round(offset.y + r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
        centerX: Math.round(offset.x + r.left + r.width / 2),
        centerY: Math.round(offset.y + r.top + r.height / 2)
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

export const documentTitleScript = (selector: string): string => `(() => {
  ${FRAME_HELPER}
  const selectors = [${JSON.stringify(selector || '#title')}, '#title', 'textarea#title', 'input[name="docTitle"]', '[name="docTitle"]', '.layui-textarea']
  let el = null
  let fallbackEl = null
  let matched = ''
  let fallbackSelector = ''
  for (const candidate of selectors) {
    if (!candidate) continue
    const matches = hqQueryAll(candidate)
    for (const candidateEl of matches) {
      if (!fallbackEl) { fallbackEl = candidateEl; fallbackSelector = candidate }
      const candidateValue = 'value' in candidateEl ? candidateEl.value : ''
      const candidateText = String(candidateValue || candidateEl.innerText || candidateEl.textContent || '').trim()
      if (candidateText) { el = candidateEl; matched = candidate; break }
    }
    if (el) break
  }
  if (!el && fallbackEl) { el = fallbackEl; matched = fallbackSelector }
  if (!el) return { found: false, pageTitle: document.title }
  const value = 'value' in el ? el.value : ''
  const text = String(value || el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim()
  if (text) flashElement(el, '读取标题')
  return {
    found: Boolean(text),
    text,
    selector: matched,
    tag: el.tagName.toLowerCase(),
    id: el.id || '',
    readonly: Boolean(el.readOnly || el.getAttribute('readonly') === 'readonly'),
    pageTitle: document.title
  }
})()`

