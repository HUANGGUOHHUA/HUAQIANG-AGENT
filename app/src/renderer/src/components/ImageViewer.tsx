import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function ImageViewer({
  dataUrl,
  onClose
}: {
  dataUrl: string
  onClose: () => void
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="image-viewer" onMouseDown={onClose}>
      <button type="button" className="image-viewer-close" onClick={onClose} aria-label="关闭大图">
        <X size={18} />
      </button>
      <img src={dataUrl} alt="附件大图" onMouseDown={(event) => event.stopPropagation()} />
    </div>
  )
}
