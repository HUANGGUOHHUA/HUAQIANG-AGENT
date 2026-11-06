import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

const EDGE_SCRIPT = String.raw`import json
import sys
from collections import deque
from PIL import Image
import numpy as np

path = sys.argv[1]
min_width = int(sys.argv[2]) if len(sys.argv) > 2 else 20
min_height = int(sys.argv[3]) if len(sys.argv) > 3 else 12
max_boxes = int(sys.argv[4]) if len(sys.argv) > 4 else 40

image = Image.open(path).convert("L")
original_width, original_height = image.size
scale = min(1.0, 1200.0 / max(original_width, original_height))
if scale < 1.0:
    image = image.resize(
        (max(1, int(original_width * scale)), max(1, int(original_height * scale))),
        Image.Resampling.BILINEAR,
    )
width, height = image.size
pixels = np.asarray(image, dtype=np.float32)

# Gradient magnitude; pad back to image size.
dx = np.zeros_like(pixels)
dy = np.zeros_like(pixels)
dx[:, 1:-1] = np.abs(pixels[:, 2:] - pixels[:, :-2])
dy[1:-1, :] = np.abs(pixels[2:, :] - pixels[:-2, :])
magnitude = np.maximum(dx, dy)

# Ignore flat areas and keep the strongest borders, then thicken them so
# adjacent border pixels form one component.
threshold = max(18.0, float(np.percentile(magnitude, 88)))
edges = magnitude >= threshold
for _ in range(2):
    expanded = edges.copy()
    expanded[1:, :] |= edges[:-1, :]
    expanded[:-1, :] |= edges[1:, :]
    expanded[:, 1:] |= edges[:, :-1]
    expanded[:, :-1] |= edges[:, 1:]
    edges = expanded

visited = np.zeros_like(edges, dtype=np.uint8)
boxes = []
for y0 in range(height):
    for x0 in range(width):
        if not edges[y0, x0] or visited[y0, x0]:
            continue
        queue = deque([(x0, y0)])
        visited[y0, x0] = 1
        left = right = x0
        top = bottom = y0
        count = 0
        while queue:
            x, y = queue.popleft()
            count += 1
            if x < left: left = x
            if x > right: right = x
            if y < top: top = y
            if y > bottom: bottom = y
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < width and 0 <= ny < height and edges[ny, nx] and not visited[ny, nx]:
                    visited[ny, nx] = 1
                    queue.append((nx, ny))
        bw = right - left + 1
        bh = bottom - top + 1
        if bw < min_width or bh < min_height:
            continue
        if bw >= width * 0.92 and bh >= height * 0.92:
            continue
        if count < 12:
            continue
        boxes.append((left, top, bw, bh, count))

# Keep larger structures first and merge near-identical rectangles.
boxes.sort(key=lambda item: item[4], reverse=True)
kept = []
for left, top, bw, bh, count in boxes:
    duplicate = False
    for other in kept:
        ox, oy, ow, oh, _ = other
        ix = max(0, min(left + bw, ox + ow) - max(left, ox))
        iy = max(0, min(top + bh, oy + oh) - max(top, oy))
        intersection = ix * iy
        if intersection > 0 and intersection / float(min(bw * bh, ow * oh)) > 0.72:
            duplicate = True
            break
    if not duplicate:
        kept.append((left, top, bw, bh, count))
    if len(kept) >= max_boxes:
        break

result = []
for left, top, bw, bh, count in kept:
    x = int(round(left / scale))
    y = int(round(top / scale))
    w = int(round(bw / scale))
    h = int(round(bh / scale))
    result.append({
        "x": x,
        "y": y,
        "width": w,
        "height": h,
        "centerX": x + w // 2,
        "centerY": y + h // 2,
        "edgePixels": int(count),
    })

print(json.dumps({
    "width": original_width,
    "height": original_height,
    "boxes": result,
}, ensure_ascii=False))
`

let scriptReady: Promise<string> | null = null

function ensureScript(): Promise<string> {
  if (scriptReady) return scriptReady
  const pending = (async () => {
    const path = join(tmpdir(), 'huaqiang-detect-edges.py')
    const current = existsSync(path) ? await readFile(path, 'utf8').catch(() => '') : ''
    if (current !== EDGE_SCRIPT) await writeFile(path, EDGE_SCRIPT, 'utf8')
    return path
  })()
  scriptReady = pending
  pending.catch(() => {
    if (scriptReady === pending) scriptReady = null
  })
  return pending
}

export interface EdgeBox {
  x: number
  y: number
  width: number
  height: number
  centerX: number
  centerY: number
  edgePixels: number
}

export interface EdgeResult {
  width: number
  height: number
  boxes: EdgeBox[]
}

/** Detect rectangular control edges in a screenshot using the local Python runtime. */
export async function detectEdges(
  path: string,
  options: { pythonPath?: string; minWidth?: number; minHeight?: number; maxBoxes?: number } = {}
): Promise<EdgeResult> {
  const script = await ensureScript()
  const { stdout } = await run(
    options.pythonPath || 'python.exe',
    [
      script,
      path,
      String(options.minWidth ?? 20),
      String(options.minHeight ?? 12),
      String(options.maxBoxes ?? 40)
    ],
    { timeout: 60_000, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' }
  )
  const parsed = JSON.parse(stdout) as Partial<EdgeResult>
  return {
    width: Number(parsed.width ?? 0),
    height: Number(parsed.height ?? 0),
    boxes: Array.isArray(parsed.boxes)
      ? parsed.boxes.map((box) => ({
          x: Number(box.x ?? 0),
          y: Number(box.y ?? 0),
          width: Number(box.width ?? 0),
          height: Number(box.height ?? 0),
          centerX: Number(box.centerX ?? 0),
          centerY: Number(box.centerY ?? 0),
          edgePixels: Number(box.edgePixels ?? 0)
        }))
      : []
  }
}
