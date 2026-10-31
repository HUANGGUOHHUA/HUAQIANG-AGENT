import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('渲染进程异常：', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="render-error">
        <h1>界面加载出错</h1>
        <p>{this.state.error.message || String(this.state.error)}</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
)
