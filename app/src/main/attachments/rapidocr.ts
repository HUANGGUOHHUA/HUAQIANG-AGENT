import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

export interface RapidOcrLine {
  text: string
  x: number
  y: number
  width: number
  height: number
  score: number
}

export interface RapidOcrResult {
  width: number
  height: number
  lines: RapidOcrLine[]
}

const WORKER = String.raw`import json
import sys
import contextlib

# RapidOCR/ONNX occasionally logs to stdout. Keep stdout clean for JSON lines.
sys.stdout.reconfigure(encoding="utf-8")
import logging
logging.disable(logging.CRITICAL)

try:
    from rapidocr import RapidOCR
except Exception as exc:
    print(json.dumps({"ready": False, "error": str(exc)}, ensure_ascii=False), flush=True)
    raise SystemExit(1)

from pathlib import Path
model_dir = Path(sys.executable).resolve().parent / "ocr-models"
model_params = {
    "Det.model_path": str(model_dir / "PP-OCRv6_det_small.onnx"),
    "Rec.model_path": str(model_dir / "PP-OCRv6_rec_small.onnx"),
    "Rec.rec_keys_path": str(model_dir / "ppocrv6_dict.txt"),
    "Global.use_cls": False,
}
if not all((model_dir / name).exists() for name in (
    "PP-OCRv6_det_small.onnx",
    "PP-OCRv6_rec_small.onnx",
    "ppocrv6_dict.txt",
)):
    # Built-in Lite fallback. It uses the bundled Indra weights.
    model_params = {"Det.model_type": "lite", "Rec.model_type": "lite"}

with contextlib.redirect_stdout(sys.stderr):
    engine = RapidOCR(params=model_params)

print(json.dumps({"ready": True}, ensure_ascii=False), flush=True)

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        request = json.loads(line)
        request_id = request.get("id")
        path = request.get("path")
        region = request.get("region")
        if region:
            from PIL import Image
            image = Image.open(path).convert("RGB")
            left = int(region.get("x", 0))
            top = int(region.get("y", 0))
            right = left + int(region.get("width", image.width))
            bottom = top + int(region.get("height", image.height))
            image = image.crop((max(0, left), max(0, top), min(image.width, right), min(image.height, bottom)))
            with contextlib.redirect_stdout(sys.stderr):
                result = engine(image)
        else:
            with contextlib.redirect_stdout(sys.stderr):
                result = engine(path)
        lines = []
        boxes = getattr(result, "boxes", None)
        texts = getattr(result, "txts", None)
        scores = getattr(result, "scores", None)
        if boxes is not None and texts is not None:
            for box, text, score in zip(boxes, texts, scores or [1.0] * len(texts)):
                points = box.tolist() if hasattr(box, "tolist") else box
                xs = [float(point[0]) for point in points]
                ys = [float(point[1]) for point in points]
                x = round(min(xs))
                y = round(min(ys))
                w = round(max(xs) - min(xs))
                h = round(max(ys) - min(ys))
                if text and w > 0 and h > 0:
                    lines.append({
                        "text": str(text),
                        "x": x,
                        "y": y,
                        "width": w,
                        "height": h,
                        "score": float(score),
                    })
        shape = getattr(getattr(result, "img", None), "shape", None)
        response = {
            "id": request_id,
            "ok": True,
            "width": int(shape[1]) if shape and len(shape) >= 2 else 0,
            "height": int(shape[0]) if shape and len(shape) >= 2 else 0,
            "lines": lines,
        }
        print(json.dumps(response, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({"id": locals().get("request_id"), "ok": False, "error": str(exc)}, ensure_ascii=False), flush=True)
`

interface Pending {
  resolve: (result: RapidOcrResult) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

let worker: ChildProcessWithoutNullStreams | null = null
let workerPython = ''
let workerScript = ''
let workerReady: Promise<void> | null = null
let pending = new Map<number, Pending>()
let nextId = 1
let stdoutBuffer = ''

async function ensureScript(): Promise<string> {
  if (workerScript && existsSync(workerScript)) return workerScript
  const path = join(tmpdir(), 'huaqiang-rapidocr-worker.py')
  const current = existsSync(path) ? await readFile(path, 'utf8').catch(() => '') : ''
  if (current !== WORKER) await writeFile(path, WORKER, 'utf8')
  workerScript = path
  return path
}

function rejectAll(error: Error): void {
  for (const entry of pending.values()) {
    clearTimeout(entry.timer)
    entry.reject(error)
  }
  pending.clear()
}

async function ensureWorker(pythonPath: string): Promise<void> {
  if (worker && !worker.killed && workerPython === pythonPath) return workerReady ?? Promise.resolve()
  if (worker) {
    worker.kill()
    worker = null
    rejectAll(new Error('OCR worker 已重启'))
  }
  workerPython = pythonPath
  const script = await ensureScript()
  workerReady = new Promise<void>((resolve, reject) => {
    const child = spawn(pythonPath, ['-u', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    worker = child
    let ready = false
    const fail = (error: Error): void => {
      if (!ready) reject(error)
      rejectAll(error)
      worker = null
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      let newline = stdoutBuffer.indexOf('\n')
      while (newline >= 0) {
        const line = stdoutBuffer.slice(0, newline).trim()
        stdoutBuffer = stdoutBuffer.slice(newline + 1)
        if (line) {
          try {
            const message = JSON.parse(line) as {
              ready?: boolean
              error?: string
              id?: number
              ok?: boolean
              width?: number
              height?: number
              lines?: RapidOcrLine[]
            }
            if (message.ready === false) {
              fail(new Error(message.error || 'RapidOCR 加载失败'))
            } else if (message.ready === true) {
              ready = true
              resolve()
            } else if (typeof message.id === 'number') {
              const entry = pending.get(message.id)
              if (!entry) continue
              pending.delete(message.id)
              clearTimeout(entry.timer)
              if (message.ok) {
                entry.resolve({
                  width: Number(message.width ?? 0),
                  height: Number(message.height ?? 0),
                  lines: Array.isArray(message.lines) ? message.lines : []
                })
              } else {
                entry.reject(new Error(message.error || 'RapidOCR 识别失败'))
              }
            }
          } catch {
            // Ignore malformed log lines; stdout is kept clean by the worker.
          }
        }
        newline = stdoutBuffer.indexOf('\n')
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', () => undefined)
    child.on('error', (error) => fail(new Error(`RapidOCR 进程启动失败：${error.message}`)))
    child.on('exit', (code) => fail(new Error(`RapidOCR 进程已退出（${code ?? 'unknown'}）`)))
  })
  return workerReady
}

export async function detectRapidOcr(
  path: string,
  pythonPath: string,
  timeoutMs = 30_000,
  region?: { x: number; y: number; width: number; height: number }
): Promise<RapidOcrResult> {
  await ensureWorker(pythonPath)
  const child = worker
  if (!child) throw new Error('RapidOCR worker 不可用')
  const id = nextId++
  return new Promise<RapidOcrResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error('RapidOCR 识别超时'))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    child.stdin.write(`${JSON.stringify({ id, path, region })}\n`)
  })
}

export function stopRapidOcr(): void {
  if (worker) {
    worker.kill()
    worker = null
  }
  rejectAll(new Error('RapidOCR worker 已停止'))
}

process.once('exit', stopRapidOcr)
