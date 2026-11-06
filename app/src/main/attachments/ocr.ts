import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

const OCR_SCRIPT = String.raw`param([string]$Path, [switch]$Json)
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -match "IAsyncOperation"
})[0]
if (-not $asTaskGeneric) { throw "Windows OCR AsTask helper not found" }
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  $netTask.Result
}
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime] > $null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime] > $null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime] > $null
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($Path)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) { throw "No Windows OCR language is installed" }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
if ($Json) {
  $lines = @()
  foreach ($line in $result.Lines) {
    $words = @($line.Words)
    if ($words.Count -eq 0) { continue }
    $left = [double]::PositiveInfinity
    $top = [double]::PositiveInfinity
    $right = 0.0
    $bottom = 0.0
    foreach ($word in $words) {
      $r = $word.BoundingRect
      $left = [Math]::Min($left, $r.X)
      $top = [Math]::Min($top, $r.Y)
      $right = [Math]::Max($right, $r.X + $r.Width)
      $bottom = [Math]::Max($bottom, $r.Y + $r.Height)
    }
    $lines += [pscustomobject]@{
      text = $line.Text
      x = [Math]::Round($left)
      y = [Math]::Round($top)
      width = [Math]::Round($right - $left)
      height = [Math]::Round($bottom - $top)
    }
  }
  [pscustomobject]@{
    width = [int]$bitmap.PixelWidth
    height = [int]$bitmap.PixelHeight
    lines = @($lines)
  } | ConvertTo-Json -Depth 4 -Compress
} else {
  $result.Text
}
`

let scriptReady: Promise<string> | null = null

function ensureScript(): Promise<string> {
  if (scriptReady) return scriptReady
  const pending = (async () => {
    const path = join(tmpdir(), 'huaqiang-win-ocr.ps1')
    const current = existsSync(path) ? await readFile(path, 'utf8').catch(() => '') : ''
    if (current !== OCR_SCRIPT) await writeFile(path, OCR_SCRIPT, 'utf8')
    return path
  })()
  scriptReady = pending
  pending.catch(() => {
    if (scriptReady === pending) scriptReady = null
  })
  return pending
}

export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/([\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, '$1')
    .replace(/([\u3400-\u9fff])\s+([，。；：！？、）】》])/g, '$1$2')
    .replace(/([，。；：！？、）】》])\s+/g, '$1')
    .replace(/([（【《])\s+([\u3400-\u9fff])/g, '$1$2')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 100_000)
}

export interface OcrLineBox {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export interface OcrBoxes {
  width: number
  height: number
  lines: OcrLineBox[]
}

/** OCR an image and return line bounding boxes in image pixels. */
export async function ocrImageBoxes(path: string): Promise<OcrBoxes> {
  const script = await ensureScript()
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', path, '-Json'],
    { timeout: 45_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }
  )
  try {
    const parsed = JSON.parse(stdout) as Partial<OcrBoxes>
    const lines = Array.isArray(parsed.lines)
      ? parsed.lines
          .map((line) => ({
            text: String(line?.text ?? '').trim(),
            x: Number(line?.x ?? 0),
            y: Number(line?.y ?? 0),
            width: Number(line?.width ?? 0),
            height: Number(line?.height ?? 0)
          }))
          .filter((line) => line.text && line.width > 0 && line.height > 0)
      : []
    return {
      width: Number(parsed.width ?? 0),
      height: Number(parsed.height ?? 0),
      lines
    }
  } catch {
    return { width: 0, height: 0, lines: [] }
  }
}

/** OCR an image with the built-in Windows.Media.Ocr engine. */
export async function ocrImage(path: string): Promise<string> {
  const script = await ensureScript()
  const { stdout } = await run(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Path', path],
    { timeout: 45_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }
  )
  return normalizeOcrText(stdout)
}
