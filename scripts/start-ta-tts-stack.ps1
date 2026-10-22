# TA self-hosted TTS stack: GPT-SoVITS api_v2.py (:9880) -> token gateway (:9881) -> cloudflared tunnel
# Usage: powershell -ExecutionPolicy Bypass -File .\scripts\start-ta-tts-stack.ps1 [-NoTunnel]
# Effect: brings up whatever is missing, then prints the token, the tunnel URL and the exact
#         `wrangler secret put` commands. Closing this window does NOT stop the background parts;
#         stop them with: Get-NetTCPConnection -LocalPort 9880,9881 | Stop-Process
# NOTE: keep this file ASCII-only - Windows PowerShell 5.1 reads .ps1 as ANSI when there is no BOM.

param(
  [switch]$NoTunnel,                        # skip cloudflared (local-only testing)
  [string]$Pkg = $env:TA_GPTSOVITS_DIR      # GPT-SoVITS integrated package
)

$ErrorActionPreference = "Stop"
if (-not $Pkg) { $Pkg = "D:\AI\GPT-SoVITS-v2pro-20250604-nvidia50" }
$TokenFile = Join-Path (Join-Path $PSScriptRoot ".tools") "ta-tts-token.txt"
$ApiPort = 9880
$GwPort = 9881

function Say([string]$Msg, [string]$Color = "Cyan") { Write-Host ('[ta-stack] ' + $Msg) -ForegroundColor $Color }

function PortBusy([int]$Port) {
  return @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue).Count -gt 0
}

function WaitHttp([string]$Url, [int]$Seconds, [string]$What) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      Say ($What + " is ready: " + $Url) "Green"
      return $true
    } catch { Start-Sleep -Seconds 3 }
  }
  Say ($What + " did not come up in " + $Seconds + "s: " + $Url) "Red"
  return $false
}

# 0) prerequisites
foreach ($exe in @("node", "npx")) {
  if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { Say ($exe + " not found - install Node.js 18+ first") "Red"; exit 1 }
}
$Py = Join-Path $Pkg "runtime\python.exe"
if (-not (Test-Path $Py)) { Say ("GPT-SoVITS runtime not found: " + $Py) "Red"; Say "set TA_GPTSOVITS_DIR or -Pkg to the integrated package path" "Yellow"; exit 1 }

# 1) VRAM heads-up (GPT-SoVITS v4 needs ~3-4 GB; ComfyUI / 35B LLM will starve it)
$comfy = @(Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match "ComfyUI" })
if ($comfy.Count -gt 0) {
  Say ("WARN: ComfyUI is running (pid " + ($comfy | Select-Object -ExpandProperty ProcessId) + ") - it holds VRAM and slows/blocks synthesis") "Yellow"
  Say "      close it first if TTS feels slow, e.g. Stop-Process -Id <pid>" "DarkGray"
}

# 2) GPT-SoVITS api_v2.py
if (PortBusy $ApiPort) {
  Say ("api_v2.py already listening on :" + $ApiPort) "Green"
} else {
  Say ("starting api_v2.py from " + $Pkg) "Cyan"
  $env:PATH = (Join-Path $Pkg "runtime") + ";" + $env:PATH   # runtime ffmpeg (mp3/m4a reference audio)
  $out = Join-Path $env:TEMP "gptsovits-api.log"
  $err = Join-Path $env:TEMP "gptsovits-api.err.txt"
  $p = Start-Process -FilePath $Py -ArgumentList "api_v2.py", "-a", "127.0.0.1", "-p", "$ApiPort" `
    -WorkingDirectory $Pkg -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  Say ("api_v2.py pid " + $p.Id + " (logs: " + $out + ")") "DarkGray"
  # model load on a busy GPU can take a while
  if (-not (WaitHttp ("http://127.0.0.1:" + $ApiPort + "/openapi.json") 240 "GPT-SoVITS api_v2")) { exit 1 }
}

# 3) bearer gateway (:9881) - api_v2.py itself has NO auth, never expose :9880
$token = $env:TA_TTS_PROXY_TOKEN
if (-not $token -and (Test-Path $TokenFile)) { $token = (Get-Content -Path $TokenFile -Raw).Trim() }
if (-not $token) {
  $bytes = New-Object byte[] 24
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $token = ([BitConverter]::ToString($bytes) -replace "-", "").ToLower()
  New-Item -ItemType Directory -Force -Path (Split-Path $TokenFile) | Out-Null
  Set-Content -Path $TokenFile -Value $token -NoNewline -Encoding Ascii
  Say ("generated new gateway token -> " + $TokenFile) "Green"
}

if (PortBusy $GwPort) {
  Say ("gateway already listening on :" + $GwPort) "Green"
} else {
  $env:TA_TTS_PROXY_PORT = "$GwPort"
  $env:TA_TTS_PROXY_TOKEN = $token
  $gwOut = Join-Path $env:TEMP "ta-tts-proxy.log"
  $gwErr = Join-Path $env:TEMP "ta-tts-proxy.err.txt"
  $gw = Start-Process node -ArgumentList (Join-Path $PSScriptRoot "ta-tts-proxy.mjs") `
    -RedirectStandardOutput $gwOut -RedirectStandardError $gwErr -WindowStyle Hidden -PassThru
  Say ("gateway pid " + $gw.Id + " (logs: " + $gwOut + ")") "DarkGray"
  if (-not (WaitHttp ("http://127.0.0.1:" + $GwPort + "/healthz") 20 "token gateway")) { exit 1 }
}

# 4) quick tunnel -> public URL for the Worker (must point at the GATEWAY, never :9880)
$tunnelUrl = ""
if (-not $NoTunnel) {
  $cf = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
  if (-not (Test-Path $cf)) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { $cf = $cmd.Source }
  }
  if (-not (Test-Path $cf)) {
    Say "cloudflared not found - install it, or rerun with -NoTunnel for local-only testing" "Yellow"
  } else {
    $cfOut = Join-Path $env:TEMP "cf-tunnel.log"
    $cfErr = Join-Path $env:TEMP "cf-tunnel.err.txt"
    Remove-Item $cfOut, $cfErr -Force -ErrorAction SilentlyContinue
    $tun = Start-Process -FilePath $cf -ArgumentList "tunnel", "--url", ("http://127.0.0.1:" + $GwPort), "--no-autoupdate" `
      -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr -WindowStyle Hidden -PassThru
    Say ("cloudflared pid " + $tun.Id + " (logs: " + $cfErr + ")") "DarkGray"
    for ($i = 0; $i -lt 20 -and -not $tunnelUrl; $i++) {
      Start-Sleep -Seconds 2
      $txt = ((Get-Content $cfErr -Raw -ErrorAction SilentlyContinue) + (Get-Content $cfOut -Raw -ErrorAction SilentlyContinue))
      $m = [regex]::Match($txt, "https://[a-z0-9-]+\.trycloudflare\.com")
      if ($m.Success) { $tunnelUrl = $m.Value }
    }
    if ($tunnelUrl) {
      Say ("tunnel URL: " + $tunnelUrl) "Green"
      Say "NOTE: a quick tunnel URL changes on every restart - for a stable one use a named tunnel" "Yellow"
      Say "      cloudflared tunnel login; cloudflared tunnel create ta-tts; cloudflared tunnel route dns ta-tts tts.hyool.com; cloudflared tunnel run ta-tts" "DarkGray"
    } else {
      Say "no tunnel URL after 40s - check the cloudflared log above" "Red"
    }
  }
}

# 5) self test: the bearer gate must reject requests without the token
$probe = '{"text":"test","text_lang":"zh","ref_audio_path":"x.wav","prompt_text":"x","prompt_lang":"zh"}'
$tmp = Join-Path $env:TEMP "ta-stack-probe.json"
Set-Content -Path $tmp -Value $probe -Encoding Ascii -NoNewline
try {
  $null = Invoke-WebRequest -Uri ("http://127.0.0.1:" + $GwPort + "/tts") -Method POST -ContentType "application/json" -InFile $tmp -UseBasicParsing -TimeoutSec 10
  Say "SECURITY: gateway answered 200 without a token - do not expose it" "Red"
} catch {
  $code = $_.Exception.Response.StatusCode.value__
  if ($code -eq 401) { Say "gateway rejects requests without the token (401) - good" "Green" }
  else { Say ("gateway returned " + $code + " without the token (expected 401)") "Yellow" }
}

# 6) hand-off: everything the Worker side needs
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host (" api_v2   : http://127.0.0.1:" + $ApiPort + "/tts   (no auth - never expose)") -ForegroundColor Green
Write-Host (" gateway  : http://127.0.0.1:" + $GwPort + "/tts   (Bearer)") -ForegroundColor Green
if ($tunnelUrl) { Write-Host (" tunnel   : " + $tunnelUrl) -ForegroundColor Green }
Write-Host (" token    : " + $token) -ForegroundColor Yellow
Write-Host "------------------------------------------------" -ForegroundColor Green
Write-Host " Worker side (run in the repo root, paste the values above):" -ForegroundColor Cyan
if ($tunnelUrl) { Write-Host "   npx wrangler secret put TA_TTS_LOCAL_URL" -ForegroundColor Cyan }
Write-Host "   npx wrangler secret put TA_TTS_LOCAL_TOKEN" -ForegroundColor Cyan
Write-Host "   npx wrangler secret put TA_TTS_LOCAL_FEMALE_REF          # local path of the 3-10s sample" -ForegroundColor Cyan
Write-Host "   npx wrangler secret put TA_TTS_LOCAL_FEMALE_PROMPT_TEXT  # transcript of that sample" -ForegroundColor Cyan
Write-Host "   (stable refs can live in wrangler.toml [vars] instead of secrets)" -ForegroundColor DarkGray
Write-Host " verify:" -ForegroundColor Cyan
Write-Host "   curl -s https://hyool.com/api/ta/config   -> tts.chain starts with gptsovits, tts.refs.female=true" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Green

