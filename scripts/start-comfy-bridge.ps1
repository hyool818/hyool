# HYOOL Comfy HTTPS bridge
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\start-comfy-bridge.ps1
# Requires: ComfyUI desktop running on port 8000
# Effect: https://127.0.0.1:8443 -> http://127.0.0.1:8000

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $PSScriptRoot "comfy-bridge.mjs"))) {
  $Root = (Get-Location).Path
}
Set-Location $Root

$CertDir = Join-Path $PSScriptRoot "comfy-bridge-certs"
$ToolsDir = Join-Path $PSScriptRoot ".tools"
$CertPem = Join-Path $CertDir "127.0.0.1+1.pem"
$KeyPem = Join-Path $CertDir "127.0.0.1+1-key.pem"
$MkcertExe = Join-Path $ToolsDir "mkcert.exe"

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null
New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

function Write-Info([string]$Msg, [string]$Color = "Cyan") {
  Write-Host ('[hyool-bridge] ' + $Msg) -ForegroundColor $Color
}

function Find-Mkcert {
  $cmd = Get-Command mkcert -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  if (Test-Path $MkcertExe) { return $MkcertExe }
  return $null
}

function Install-MkcertLocal {
  Write-Info "Downloading mkcert (free local CA tool)..."
  $url = "https://github.com/FiloSottile/mkcert/releases/download/v1.4.4/mkcert-v1.4.4-windows-amd64.exe"
  try {
    Invoke-WebRequest -Uri $url -OutFile $MkcertExe -UseBasicParsing
  } catch {
    Write-Info ("Download failed: " + $_.Exception.Message) "Red"
    Write-Host "Install mkcert manually: https://github.com/FiloSottile/mkcert#windows" -ForegroundColor Yellow
    exit 1
  }
  return $MkcertExe
}

$mkcert = Find-Mkcert
if (-not $mkcert) { $mkcert = Install-MkcertLocal }

if (-not (Test-Path $CertPem) -or -not (Test-Path $KeyPem)) {
  Write-Info "Installing local CA (once, free)..."
  & $mkcert -install
  if ($LASTEXITCODE -ne 0) {
    Write-Info "mkcert -install failed. Re-run this script as Administrator." "Red"
    exit 1
  }
  Write-Info "Generating certificate for 127.0.0.1 ..."
  Push-Location $CertDir
  try {
    & $mkcert -cert-file "127.0.0.1+1.pem" -key-file "127.0.0.1+1-key.pem" 127.0.0.1 localhost
    if ($LASTEXITCODE -ne 0) { throw "mkcert cert generation failed" }
  } finally {
    Pop-Location
  }
} else {
  Write-Info "Certificate already exists, skip." "DarkGray"
}

$comfyTarget = $null
foreach ($port in @(8000, 8188)) {
  try {
    $null = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $port + "/system_stats") -UseBasicParsing -TimeoutSec 2
    $comfyTarget = "http://127.0.0.1:" + $port
    Write-Info ("ComfyUI detected on :" + $port) "Green"
    break
  } catch {}
}
if (-not $comfyTarget) {
  $comfyTarget = "http://127.0.0.1:8188"
  Write-Info "WARN: Comfy not found on :8000 or :8188. Will proxy to :8188 anyway - start Comfy first." "Yellow"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Bridge: https://127.0.0.1:8443" -ForegroundColor Green
Write-Host (" Target: " + $comfyTarget) -ForegroundColor Green
Write-Host " 1) Keep this window open" -ForegroundColor Green
Write-Host " 2) Open HYOOL (https), pick local ComfyUI" -ForegroundColor Green
Write-Host " 3) Base URL auto-uses https://127.0.0.1:8443" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

# Free :8443 if a previous bridge is still hanging
try {
  $conns = Get-NetTCPConnection -LocalPort 8443 -State Listen -ErrorAction SilentlyContinue
  $procIds = @($conns | Select-Object -ExpandProperty OwningProcess -Unique)
  foreach ($procId in $procIds) {
    if ($procId -and $procId -ne $PID) {
      Write-Info ("Port 8443 busy - stopping old process $procId") "Yellow"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 500
} catch {}

$env:HYOOL_BRIDGE_PORT = "8443"
$env:HYOOL_COMFY_TARGET = $comfyTarget
node (Join-Path $PSScriptRoot "comfy-bridge.mjs")
