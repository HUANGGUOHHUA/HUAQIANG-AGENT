import { Children, isValidElement, useMemo, useRef, useState, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Check, Copy } from 'lucide-react'

function CodeBlock({ children }: { children?: ReactNode }): React.JSX.Element {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const first = Children.toArray(children)[0]
  const className = isValidElement<{ className?: string }>(first) ? first.props.className ?? '' : ''
  const language = /language-([\w-]+)/.exec(className)?.[1] ?? 'code'

  const copy = async (): Promise<void> => {
    const text = preRef.current?.innerText ?? ''
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // Clipboard may be unavailable.
    }
  }

  return (
    <div className="code-block">
      <div className="code-head">
        <span className="code-language">{language}</span>
        <button type="button" className="code-copy" onClick={() => void copy()}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre ref={preRef}>{children}</pre>
    </div>
  )
}

export default function Markdown({
  content,
  className,
  highlight = true
}: {
  content: string
  className?: string
  highlight?: boolean
}): React.JSX.Element {
  const useHighlight = highlight && content.length < 80_000
  const components = useMemo<Components>(
    () => ({
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      a: ({ href, children, title }) => (
        <a
          href={href}
          title={title}
          onClick={(event) => {
            event.preventDefault()
            if (href && /^https?:\/\//i.test(href)) void window.hq.openExternal(href)
          }}
        >
          {children}
        </a>
      ),
      table: ({ children }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
      img: ({ src, alt, title }) => {
        const safe =
          typeof src === 'string' && /^(https?:\/\/|data:image\/)/i.test(src) ? src : undefined
        return <img src={safe} alt={alt ?? ''} title={title} loading="lazy" />
      }
    }),
    []
  )
  const remarkPlugins = useMemo(() => [remarkGfm], [])
  const rehypePlugins = useMemo<PluggableList>(
    () => (useHighlight ? [[rehypeHighlight, { detect: false, ignoreMissing: true }]] : []),
    [useHighlight]
  )
  return (
    <div className={`markdown ${className ?? ''}`}>
      <ReactMarkdown
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
