# TA self-hosted TTS gateway (token-guarded reverse proxy)
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-proxy.ps1
# Effect: http://127.0.0.1:9881/tts (Bearer) -> http://127.0.0.1:9880/tts (GPT-SoVITS api_v2.py)
# Token: env TA_TTS_PROXY_TOKEN wins; otherwise read/generate scripts\.tools\ta-tts-token.txt (gitignored)
# NOTE: keep this file ASCII-only - Windows PowerShell 5.1 reads .ps1 as ANSI when there is no BOM.

$ErrorActionPreference = "Stop"
$TokenDir = Join-Path $PSScriptRoot ".tools"
$TokenFile = Join-Path $TokenDir "ta-tts-token.txt"
$ListenPort = 9881
$UpstreamPort = 9880

function Write-Info([string]$Msg, [string]$Color = "Cyan") {
  Write-Host ('[ta-tts] ' + $Msg) -ForegroundColor $Color
}

# 0) node required
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Info "node.exe not found - install Node.js 18+ first" "Red"
  exit 1
}

# 1) upstream GPT-SoVITS HTTP API (api_v2.py) alive?
$upOk = $false
try {
  $null = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $UpstreamPort + "/openapi.json") -UseBasicParsing -TimeoutSec 3
  $upOk = $true
} catch {}
if ($upOk) {
  Write-Info ("GPT-SoVITS api_v2.py is listening on :" + $UpstreamPort) "Green"
} else {
  Write-Info ("WARN: :" + $UpstreamPort + " not responding - start api_v2.py first, or the gateway can only return 502") "Yellow"
  Write-Info ("      cd D:\ai\GPT-SoVITS-v2pro-20250604-nvidia50; .\runtime\python.exe -I api_v2.py") "DarkGray"
}

# 2) token: env > file > new
$token = $env:TA_TTS_PROXY_TOKEN
if (-not $token -and (Test-Path $TokenFile)) {
  $token = (Get-Content -Path $TokenFile -Raw).Trim()
}
if (-not $token) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ([BitConverter]::ToString($bytes) -replace '-', '').ToLower()
  New-Item -ItemType Directory -Force -Path $TokenDir | Out-Null
  Set-Content -Path $TokenFile -Value $token -NoNewline -Encoding Ascii
  Write-Info ("generated new token -> " + $TokenFile) "Green"
} else {
  Write-Info ("reusing token file " + $TokenFile) "DarkGray"
}

# 3) free :9881 (leftover process)
try {
  $conns = Get-NetTCPConnection -LocalPort $ListenPort -State Listen -ErrorAction SilentlyContinue
  foreach ($procId in @($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
    if ($procId -and $procId -ne $PID) {
      Write-Info ("port " + $ListenPort + " busy - stopping old process " + $procId) "Yellow"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    }
  }
  Start-Sleep -Milliseconds 400
} catch {}

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host (" Gateway : http://127.0.0.1:" + $ListenPort + "/tts  (Bearer)") -ForegroundColor Green
Write-Host (" Upstream: http://127.0.0.1:" + $UpstreamPort + "/tts  (GPT-SoVITS)") -ForegroundColor Green
Write-Host " 1) Keep this window open (closing it = TA falls back to MeloTTS)" -ForegroundColor Green
Write-Host (" 2) Tunnel MUST point at the gateway: cloudflared tunnel --url http://127.0.0.1:" + $ListenPort) -ForegroundColor Yellow
Write-Host " 3) Worker side: TA_TTS_LOCAL_URL = tunnel host (/tts is appended by code)" -ForegroundColor Yellow
Write-Host "    Worker side: npx wrangler secret put TA_TTS_LOCAL_TOKEN" -ForegroundColor Yellow
Write-Host ""
Write-Host (" Token   : " + $token) -ForegroundColor Yellow
Write-Host "================================================" -ForegroundColor Green
Write-Host ""

$env:TA_TTS_PROXY_PORT = [string]$ListenPort
$env:TA_TTS_PROXY_TOKEN = $token
node (Join-Path $PSScriptRoot "ta-tts-proxy.mjs")
