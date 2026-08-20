$pidFile = 'd:\hyool\.dev-pid.txt'
if (Test-Path $pidFile) {
    $pidVal = [int](Get-Content $pidFile | Select-Object -First 1)
    Stop-Process -Id $pidVal -Force -ErrorAction SilentlyContinue
    # also kill child node processes spawned under it
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ParentProcessId -eq $pidVal } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Host ("stopped " + $pidVal)
} else {
    Write-Host "no pid file"
}
Remove-Item 'd:\hyool\.dev-pid.txt' -ErrorAction SilentlyContinue
