$log = 'd:\hyool\.wrangler-dev.log'
$err = 'd:\hyool\.wrangler-dev.err.log'
Remove-Item $log, $err -ErrorAction SilentlyContinue
$p = Start-Process -FilePath 'npx.cmd' `
    -ArgumentList @('wrangler','dev','--port','8787') `
    -WorkingDirectory 'd:\hyool' `
    -RedirectStandardOutput $log `
    -RedirectStandardError $err `
    -PassThru -WindowStyle Hidden
$p.Id | Out-File 'd:\hyool\.dev-pid.txt'
Write-Host ("started pid " + $p.Id)
# wait up to 90s for ready
$deadline = (Get-Date).AddSeconds(90)
$ready = $false
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    if (Test-Path $log) {
        $txt = Get-Content $log -Raw -ErrorAction SilentlyContinue
        if ($txt -match 'Ready on|http://|http://127') { $ready = $true; break }
        if ($txt -match 'Error|error|Exception') {
            $e = Get-Content $err -Raw -ErrorAction SilentlyContinue
            if ($e -match 'Error') { Write-Host ('ERR detected: ' + ($e.Substring(0, [Math]::Min(600, $e.Length)))); break }
        }
    }
}
Write-Host ("ready: " + $ready)
Write-Host "----- log tail -----"
Get-Content $log -Tail 30 -ErrorAction SilentlyContinue
Write-Host "----- err tail -----"
Get-Content $err -Tail 30 -ErrorAction SilentlyContinue
