# run-browser-test.ps1 - run Chrome headless via CDP and execute a page until it sets a final title
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [Parameter(Mandatory = $true)][string]$OutFile,
  [int]$TimeoutSec = 150
)
$ErrorActionPreference = 'Stop'

$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
if (-not (Test-Path $chrome)) {
  $chrome = (Get-Command chrome.exe -ErrorAction SilentlyContinue).Source
  if (-not $chrome) { throw 'Chrome not found' }
}

$port = Get-Random -Minimum 20000 -Maximum 40000
$env:CDP_PORT = "$port"
$profile = Join-Path $env:TEMP ('hyool-cdp-' + [guid]::NewGuid().ToString('N'))

$args = @(
  '--headless=new', '--disable-gpu', '--no-sandbox',
  "--remote-debugging-port=$port",
  "--user-data-dir=$profile",
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--autoplay-policy=no-user-gesture-required',
  'about:blank'
)
$p = Start-Process -FilePath $chrome -ArgumentList $args -WindowStyle Hidden -PassThru

try {
  $ready = $false
  for ($i = 0; $i -lt 100; $i++) {
    try {
      Invoke-RestMethod -Uri "http://127.0.0.1:$port/json/version" -TimeoutSec 2 | Out-Null
      $ready = $true
      break
    } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $ready) { throw "CDP endpoint not ready on port $port" }

  $env:CDP_TIMEOUT = "$TimeoutSec"
  node (Join-Path $PSScriptRoot 'cdp-driver.js') $Url $OutFile
  exit $LASTEXITCODE
} finally {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
  Remove-Item -Recurse -Force $profile -ErrorAction SilentlyContinue
}
