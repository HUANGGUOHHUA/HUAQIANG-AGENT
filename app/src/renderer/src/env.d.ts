/// <reference types="vite/client" />

import type { HqApi } from '../../shared/types'

declare global {
  interface Window {
    hq: HqApi
  }

  interface HqWebviewElement extends HTMLElement {
    loadURL: (url: string) => Promise<void>
    getURL: () => string
    getTitle: () => string
    canGoBack: () => boolean
    canGoForward: () => boolean
    goBack: () => void
    goForward: () => void
    reload: () => void
    stop: () => void
    executeJavaScript: (code: string) => Promise<unknown>
    findInPage: (text: string, options?: { forward?: boolean; findNext?: boolean }) => number
    stopFindInPage: (action: 'clearSelection' | 'keepSelection' | 'activateSelection') => void
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        partition?: string
        src?: string
        allowpopups?: string
      }
    }
  }
}

export {}
