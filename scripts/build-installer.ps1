param(
    [string]$SignThumbprint = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw 'csc.exe not found (requires .NET Framework 4.x).' }

$release = Join-Path $root 'output'
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$payload = Join-Path $release 'app.zip'
$uninstaller = Join-Path $release 'Uninstall.exe'
$setupName = "HuaqiangAgent-$version-setup.exe"
$portableName = "HuaqiangAgent-$version-portable.exe"
$setup = Join-Path $release $setupName
$portable = Join-Path $release $portableName
$winUnpacked = Join-Path $release 'win-unpacked'

New-Item -ItemType Directory -Force -Path $release | Out-Null

if (-not (Test-Path $payload)) {
    if (Test-Path $portable) {
        Write-Host 'Extracting app payload from the portable executable...'
        $assembly = [Reflection.Assembly]::Load([IO.File]::ReadAllBytes($portable))
        $stream = $assembly.GetManifestResourceStream('HuaqiangAgent.App.zip')
        if (-not $stream) { throw 'HuaqiangAgent.App.zip not found in the portable executable.' }
        $output = [IO.File]::Create($payload)
        try { $stream.CopyTo($output) } finally { $output.Dispose(); $stream.Dispose() }
    } elseif (Test-Path (Join-Path $winUnpacked 'HuaqiangAgent.exe')) {
        Write-Host 'Creating app payload from output\win-unpacked...'
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory(
            $winUnpacked, $payload, [IO.Compression.CompressionLevel]::Optimal, $false)
    } else {
        throw 'Missing output\app.zip. Run "npm run pack" first, or keep the portable executable next to this script.'
    }
}

Write-Host 'Building uninstaller...'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
    /win32icon:build\icon.ico /win32manifest:installer\setup\uninstaller.manifest `
    /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Core.dll `
    /out:$uninstaller installer\setup\Uninstaller.cs
if ($LASTEXITCODE -ne 0) { throw "Uninstaller build failed ($LASTEXITCODE)." }

if ($SignThumbprint) {
    Write-Host 'Signing uninstaller...'
    & (Join-Path $PSScriptRoot 'sign.ps1') -FilePath $uninstaller -Thumbprint $SignThumbprint
}

Write-Host 'Building installer...'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 `
    /win32icon:build\icon.ico /win32manifest:installer\setup\installer.manifest `
    /resource:$payload,HuaqiangAgent.App.zip `
    /resource:$uninstaller,HuaqiangAgent.Uninstaller.exe `
    /resource:app\src\renderer\src\assets\emblem.png,HuaqiangAgent.Logo.png `
    /r:Microsoft.CSharp.dll /r:System.Core.dll /r:System.IO.Compression.dll `
    /r:System.IO.Compression.FileSystem.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll `
    /out:$setup installer\setup\Installer.cs
if ($LASTEXITCODE -ne 0) { throw "Installer build failed ($LASTEXITCODE)." }

if ($SignThumbprint) {
    Write-Host 'Signing installer...'
    & (Join-Path $PSScriptRoot 'sign.ps1') -FilePath $setup -Thumbprint $SignThumbprint
}

$hash = (Get-FileHash $setup -Algorithm SHA256).Hash
"$hash  $setupName" | Set-Content "$setup.sha256" -Encoding ascii
$item = Get-Item $setup
Write-Host ("Installer: {0} ({1:N1} MB)" -f $item.FullName, ($item.Length / 1MB))
Write-Host "SHA256: $hash"
