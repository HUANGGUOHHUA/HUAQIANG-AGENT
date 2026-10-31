import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  Crop,
  Eraser,
  Pen,
  Square,
  Undo2,
  X
} from 'lucide-react'
import type { ScreenshotResult } from '../../../shared/types'

interface SelectRect {
  x: number
  y: number
  width: number
  height: number
}

type Tool = 'pen' | 'rect' | 'arrow'

interface Point {
  x: number
  y: number
}

interface Stroke {
  tool: Tool
  color: string
  width: number
  points: Point[]
}

const MAX_EDGE = 2600
const COLORS = ['#e11d48', '#f59e0b', '#2563eb', '#111827']

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const [start, ...rest] = stroke.points
  if (!start) return
  ctx.save()
  ctx.strokeStyle = stroke.color
  ctx.fillStyle = stroke.color
  ctx.lineWidth = stroke.width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (stroke.tool === 'pen') {
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    for (const point of rest) ctx.lineTo(point.x, point.y)
    if (!rest.length) ctx.lineTo(start.x + 0.1, start.y + 0.1)
    ctx.stroke()
  } else if (stroke.tool === 'rect') {
    const end = stroke.points[stroke.points.length - 1] ?? start
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    ctx.strokeRect(x, y, Math.abs(end.x - start.x), Math.abs(end.y - start.y))
  } else {
    const end = stroke.points[stroke.points.length - 1] ?? start
    ctx.beginPath()
    ctx.moveTo(start.x, start.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    const angle = Math.atan2(end.y - start.y, end.x - start.x)
    const head = Math.max(10, stroke.width * 4)
    ctx.beginPath()
    ctx.moveTo(end.x, end.y)
    ctx.lineTo(end.x - head * Math.cos(angle - Math.PI / 7), end.y - head * Math.sin(angle - Math.PI / 7))
    ctx.lineTo(end.x - head * Math.cos(angle + Math.PI / 7), end.y - head * Math.sin(angle + Math.PI / 7))
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}

export default function ScreenshotOverlay({
  shot,
  onCancel,
  onConfirm
}: {
  shot: ScreenshotResult
  onCancel: () => void
  onConfirm: (dataUrl: string) => void
}): React.JSX.Element {
  const shotImgRef = useRef<HTMLImageElement>(null)
  const cropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const annotCanvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const liveStrokeRef = useRef<Stroke | null>(null)
  const dragStartRef = useRef<Point | null>(null)

  const [stage, setStage] = useState<'select' | 'annotate'>('select')
  const [rect, setRect] = useState<SelectRect | null>(null)
  const [imageRect, setImageRect] = useState<SelectRect | null>(null)
  const [pixelSize, setPixelSize] = useState<{ width: number; height: number } | null>(null)
  const [crop, setCrop] = useState<{ url: string; width: number; height: number } | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [strokeCount, setStrokeCount] = useState(0)

  useEffect(() => {
    void window.hq.setFullscreen(true).catch(() => undefined)
    return () => {
      void window.hq.setFullscreen(false).catch(() => undefined)
    }
  }, [])

  const measureImage = useCallback((): void => {
    const img = shotImgRef.current
    if (!img) return
    const bounds = img.getBoundingClientRect()
    setImageRect({ x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height })
  }, [])

  useEffect(() => {
    if (stage !== 'select') return
    measureImage()
    window.addEventListener('resize', measureImage)
    return () => window.removeEventListener('resize', measureImage)
  }, [measureImage, stage])

  const redrawAnnotations = useCallback((): void => {
    const canvas = annotCanvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke)
    if (liveStrokeRef.current) drawStroke(ctx, liveStrokeRef.current)
  }, [])

  const enterAnnotate = useCallback((): void => {
    if (!rect || rect.width < 5 || rect.height < 5) return
    const img = shotImgRef.current
    if (!img) return
    const bounds = img.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return
    const scaleX = img.naturalWidth / bounds.width
    const scaleY = img.naturalHeight / bounds.height
    const sx = Math.max(0, Math.round((rect.x - bounds.left) * scaleX))
    const sy = Math.max(0, Math.round((rect.y - bounds.top) * scaleY))
    const sw = Math.min(img.naturalWidth - sx, Math.round(rect.width * scaleX))
    const sh = Math.min(img.naturalHeight - sy, Math.round(rect.height * scaleY))
    if (sw < 2 || sh < 2) return
    const shrink = Math.min(1, MAX_EDGE / Math.max(sw, sh))
    const outWidth = Math.max(1, Math.round(sw * shrink))
    const outHeight = Math.max(1, Math.round(sh * shrink))
    const canvas = document.createElement('canvas')
    canvas.width = outWidth
    canvas.height = outHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outWidth, outHeight)
    cropCanvasRef.current = canvas
    strokesRef.current = []
    liveStrokeRef.current = null
    setStrokeCount(0)
    setCrop({ url: canvas.toDataURL('image/png'), width: outWidth, height: outHeight })
    setStage('annotate')
  }, [rect])

  useEffect(() => {
    if (stage !== 'annotate' || !crop) return
    const canvas = annotCanvasRef.current
    if (!canvas) return
    canvas.width = crop.width
    canvas.height = crop.height
    redrawAnnotations()
  }, [stage, crop, redrawAnnotations])

  const backToSelect = useCallback((): void => {
    setStage('select')
    setCrop(null)
    setRect(null)
    setPixelSize(null)
    strokesRef.current = []
    liveStrokeRef.current = null
    setStrokeCount(0)
  }, [])

  const confirmAll = useCallback((): void => {
    const cropCanvas = cropCanvasRef.current
    if (!cropCanvas) return
    const out = document.createElement('canvas')
    out.width = cropCanvas.width
    out.height = cropCanvas.height
    const ctx = out.getContext('2d')
    if (!ctx) return
    ctx.drawImage(cropCanvas, 0, 0)
    const annot = annotCanvasRef.current
    if (annot && strokesRef.current.length) ctx.drawImage(annot, 0, 0, out.width, out.height)
    onConfirm(out.toDataURL('image/png'))
  }, [onConfirm])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
      else if (event.key === 'Enter') {
        if (stage === 'annotate') {
          event.preventDefault()
          confirmAll()
        }
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && stage === 'annotate') {
        event.preventDefault()
        strokesRef.current.pop()
        redrawAnnotations()
        setStrokeCount(strokesRef.current.length)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, confirmAll, onCancel, redrawAnnotations])

  // ---- select stage ----
  const onSelectDown = useCallback((event: React.MouseEvent): void => {
    if (event.button !== 0) return
    event.preventDefault()
    dragStartRef.current = { x: event.clientX, y: event.clientY }
    setRect({ x: event.clientX, y: event.clientY, width: 0, height: 0 })
    setPixelSize(null)
  }, [])

  const onSelectMove = useCallback((event: React.MouseEvent): void => {
    const start = dragStartRef.current
    if (!start) return
    const x = Math.min(start.x, event.clientX)
    const y = Math.min(start.y, event.clientY)
    const width = Math.abs(event.clientX - start.x)
    const height = Math.abs(event.clientY - start.y)
    setRect({ x, y, width, height })
    const img = shotImgRef.current
    if (img && imageRect && imageRect.width > 0) {
      const scaleX = img.naturalWidth / imageRect.width
      const scaleY = img.naturalHeight / imageRect.height
      setPixelSize({ width: Math.round(width * scaleX), height: Math.round(height * scaleY) })
    }
  }, [imageRect])

  const onSelectUp = useCallback((): void => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    enterAnnotate()
  }, [enterAnnotate])

  // ---- annotate stage ----
  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = event.currentTarget
    const bounds = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height
    }
  }

  const onAnnotDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      if (event.button !== 0) return
      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)
      const canvas = event.currentTarget
      const scale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width)
      liveStrokeRef.current = {
        tool,
        color,
        width: Math.max(2, 3 * scale),
        points: [pointFromEvent(event)]
      }
      redrawAnnotations()
    },
    [tool, color, redrawAnnotations]
  )

  const onAnnotMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): void => {
      const live = liveStrokeRef.current
      if (!live) return
      const point = pointFromEvent(event)
      if (live.tool === 'pen') live.points.push(point)
      else live.points = [live.points[0], point]
      redrawAnnotations()
    },
    [redrawAnnotations]
  )

  const onAnnotUp = useCallback((): void => {
    const live = liveStrokeRef.current
    if (!live) return
    liveStrokeRef.current = null
    const [start, end] = [live.points[0], live.points[live.points.length - 1]]
    const tiny = !end || (Math.abs(end.x - start.x) < 2 && Math.abs(end.y - start.y) < 2)
    if (!tiny) strokesRef.current.push(live)
    redrawAnnotations()
    setStrokeCount(strokesRef.current.length)
  }, [redrawAnnotations])

  const undo = (): void => {
    strokesRef.current.pop()
    redrawAnnotations()
    setStrokeCount(strokesRef.current.length)
  }

  const clearAll = (): void => {
    strokesRef.current = []
    redrawAnnotations()
    setStrokeCount(0)
  }

  const toolButton = (value: Tool, label: string, icon: React.ReactNode): React.JSX.Element => (
    <button
      type="button"
      className={`shot-tool ${tool === value ? 'active' : ''}`}
      title={label}
      aria-pressed={tool === value}
      onClick={() => setTool(value)}
    >
      {icon}
    </button>
  )

  if (stage === 'annotate' && crop) {
    return (
      <div className="shot-overlay shot-overlay-editor">
        <div className="shot-editor-wrap">
          <div className="shot-editor-stage">
            <img src={crop.url} alt="截图预览" draggable={false} />
            <canvas
              ref={annotCanvasRef}
              className="shot-annot-canvas"
              onPointerDown={onAnnotDown}
              onPointerMove={onAnnotMove}
              onPointerUp={onAnnotUp}
              onPointerLeave={onAnnotUp}
            />
          </div>
        </div>
        <div className="shot-toolbar shot-editor-toolbar">
          <div className="shot-tools-group">
            {toolButton('pen', '画笔', <Pen size={14} />)}
            {toolButton('rect', '矩形框', <Square size={14} />)}
            {toolButton('arrow', '箭头', <ArrowUpRight size={14} />)}
          </div>
          <div className="shot-colors">
            {COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={`shot-color ${color === item ? 'active' : ''}`}
                style={{ background: item }}
                title="颜色"
                onClick={() => setColor(item)}
              />
            ))}
          </div>
          <div className="shot-tools-group">
            <button type="button" className="shot-tool" title="撤销（Ctrl+Z）" onClick={undo} disabled={strokeCount === 0}>
              <Undo2 size={14} />
            </button>
            <button type="button" className="shot-tool" title="清空标注" onClick={clearAll} disabled={strokeCount === 0}>
              <Eraser size={14} />
            </button>
          </div>
          <span className="shot-size-text">{crop.width} × {crop.height}</span>
          <div className="shot-actions">
            <button type="button" className="shot-tool" title="重新框选" onClick={backToSelect}>
              <Crop size={14} />
            </button>
            <button type="button" className="btn ghost" onClick={onCancel}>
              <X size={14} /> 取消
            </button>
            <button type="button" className="btn primary" onClick={confirmAll}>
              <Check size={14} /> 使用截图
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="shot-overlay"
      onMouseDown={onSelectDown}
      onMouseMove={onSelectMove}
      onMouseUp={onSelectUp}
    >
      <img ref={shotImgRef} src={shot.dataUrl} alt="屏幕截图" className="shot-image" draggable={false} />
      {rect && (
        <div
          className="shot-select"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          {pixelSize && pixelSize.width > 0 && (
            <span className="shot-size">
              {pixelSize.width} × {pixelSize.height}
            </span>
          )}
        </div>
      )}
      <div className="shot-hint">拖动鼠标框选区域 · 松开后可直接标注 · Esc 取消</div>
      <div
        className="shot-toolbar"
        onMouseDown={(event) => event.stopPropagation()}
        onMouseUp={(event) => event.stopPropagation()}
      >
        <button type="button" className="btn ghost" onClick={onCancel}>
          <X size={14} /> 取消
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={enterAnnotate}
          disabled={!rect || rect.width < 5 || rect.height < 5}
        >
          <Check size={14} /> 下一步
        </button>
      </div>
    </div>
  )
}
