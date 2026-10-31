import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'

const run = promisify(execFile)

const OCR_SCRIPT = String.raw`param([string]$Path)
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
$result.Text
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
