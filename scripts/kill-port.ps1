$connections = Get-NetTCPConnection -LocalPort 3333 -ErrorAction SilentlyContinue
foreach ($conn in $connections) {
    $procId = $conn.OwningProcess
    if ($procId -gt 0) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "Killed PID $procId"
    }
}
Write-Host "Done"
