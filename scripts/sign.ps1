param(
  [Parameter(Mandatory = $true)]
  [string[]]$FilePath,

  [string]$Thumbprint = "FDDF3148FB955EB92B50874C503968ADDACDC119",
  [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$signtool = Join-Path $PSScriptRoot "..\node_modules\@electron\windows-sign\vendor\signtool.exe"
$signtool = (Resolve-Path $signtool).Path

foreach ($file in $FilePath) {
  if (-not (Test-Path -LiteralPath $file)) { throw "File not found: $file" }
  Write-Host "Signing $file ..."
  $arguments = @("sign", "/sha1", $Thumbprint, "/fd", "SHA256")
  if ($TimestampServer) {
    $arguments += @("/tr", $TimestampServer, "/td", "SHA256")
  }
  $arguments += $file
  & $signtool @arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Timestamp signing failed; retrying without timestamp..." -ForegroundColor Yellow
    & $signtool sign /sha1 $Thumbprint /fd SHA256 $file
    if ($LASTEXITCODE -ne 0) { throw "Signing failed: $file" }
  }
  $signature = Get-AuthenticodeSignature -LiteralPath $file
  if ($signature.Status -ne "Valid") {
    throw "Signature is not valid for $file ($($signature.Status))"
  }
  Write-Host "Signed: $($signature.SignerCertificate.Subject)" -ForegroundColor Green
}
