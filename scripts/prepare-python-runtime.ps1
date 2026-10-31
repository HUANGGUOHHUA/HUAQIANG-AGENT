# Rebuild the portable Python runtime bundled with 华强以太.
# The resulting runtime/python can be moved with the app to another Windows x64 PC.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $root 'runtime\python'
$zip = Join-Path $env:TEMP 'python-3.12.10-embed-amd64.zip'

if (Test-Path $runtime) { Remove-Item $runtime -Recurse -Force }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null

if (-not (Test-Path $zip)) {
  Invoke-WebRequest -Uri 'https://mirrors.huaweicloud.com/python/3.12.10/python-3.12.10-embed-amd64.zip' -OutFile $zip
}
Expand-Archive -Path $zip -DestinationPath $runtime -Force

# Make the embeddable interpreter aware of its local site-packages.
@('python312.zip', '.', 'Lib\site-packages', 'import site') |
  Set-Content -Path (Join-Path $runtime 'python312._pth') -Encoding ASCII

$site = Join-Path $runtime 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $site | Out-Null

# Bootstrap pip using any working system Python 3.12, then install into the portable runtime.
& python -m pip install --disable-pip-version-check --no-input --upgrade --target $site `
  -i https://pypi.tuna.tsinghua.edu.cn/simple pip

$python = Join-Path $runtime 'python.exe'
& $python -m pip install --disable-pip-version-check --no-input --prefer-binary `
  --no-warn-script-location --timeout 45 --retries 2 `
  -i https://pypi.tuna.tsinghua.edu.cn/simple `
  openpyxl python-docx python-pptx pypdf reportlab pandas numpy matplotlib `
  Pillow requests beautifulsoup4 XlsxWriter pdfplumber

# Bundle the VC++ runtime DLLs needed by compiled wheels.
foreach ($name in @('msvcp140.dll', 'msvcp140_1.dll', 'msvcp140_2.dll', 'concrt140.dll', 'vcomp140.dll')) {
  $source = Join-Path $env:SystemRoot "System32\$name"
  if (Test-Path $source) { Copy-Item $source (Join-Path $runtime $name) -Force }
}

& $python -c "import openpyxl, docx, pptx, pypdf, reportlab, pandas, numpy, matplotlib, PIL, requests, bs4, xlsxwriter, pdfplumber; print('portable Python runtime ready')"
