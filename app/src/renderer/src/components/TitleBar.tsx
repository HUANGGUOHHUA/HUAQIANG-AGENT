import { useEffect, useRef, useState } from 'react'
import { Maximize2, Minimize2, Minus, X, ZoomIn, ZoomOut } from 'lucide-react'
import emblem from '../assets/emblem.png'

const ZOOM_MIN = 0.8
const ZOOM_MAX = 2
const ZOOM_STEP = 0.1
const ZOOM_KEY = 'hq.zoom'

export default function TitleBar(): React.JSX.Element {
  const [maximized, setMaximized] = useState(false)
  const [zoom, setZoom] = useState(1)
  const setZoomApi = window.hq.setZoom ?? (async (value: number) => value)

  useEffect(() => {
    void window.hq.isMaximized().then(setMaximized).catch(() => undefined)
    return window.hq.onWindowState(setMaximized)
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem(ZOOM_KEY)
    const saved = raw === null || raw.trim() === '' ? NaN : Number(raw)
    const initial = Number.isFinite(saved) ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, saved)) : 1
    void setZoomApi(initial)
      .then(setZoom)
      .catch(() => undefined)
  }, [])

  const applyZoom = (next: number): void => {
    const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 100) / 100))
    void setZoomApi(clamped)
      .then((value) => {
        setZoom(value)
        localStorage.setItem(ZOOM_KEY, String(value))
      })
      .catch(() => undefined)
  }

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src={emblem} alt="" className="titlebar-mark" />
        <span className="titlebar-school">深圳市福田区华强职业技术学校</span>
      </div>
      <div className="titlebar-motto">华而实，善则强</div>
      <div className="window-controls">
        <div className="zoom-controls">
          <button
            type="button"
            className="window-btn"
            aria-label="缩小界面"
            title="缩小界面"
            onClick={() => applyZoom(zoom - ZOOM_STEP)}
          >
            <ZoomOut size={15} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            className="zoom-percent"
            title="重置为 100%"
            onClick={() => applyZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            className="window-btn"
            aria-label="放大界面"
            title="放大界面"
            onClick={() => applyZoom(zoom + ZOOM_STEP)}
          >
            <ZoomIn size={15} strokeWidth={1.8} />
          </button>
        </div>
        <button
          type="button"
          className="window-btn"
          aria-label="最小化"
          onClick={() => void window.hq.minimizeWindow()}
        >
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          className="window-btn"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => void window.hq.toggleMaximize().then(setMaximized).catch(() => undefined)}
        >
          {maximized ? <Minimize2 size={13} strokeWidth={1.8} /> : <Maximize2 size={13} strokeWidth={1.8} />}
        </button>
        <button
          type="button"
          className="window-btn close"
          aria-label="关闭"
          onClick={() => void window.hq.closeWindow()}
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}
