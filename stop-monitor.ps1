# Gracefully stop backend and all managed Spring Boot services

try {
    Invoke-RestMethod `
        -Uri "http://127.0.0.1:3001/shutdown" `
        -Method Post `
        -TimeoutSec 5 | Out-Null

    Write-Host "Backend shutdown requested."
}
catch {
    Write-Host "Backend is not running or shutdown request failed."
}

# Stop frontend

$frontend = Get-NetTCPConnection `
    -LocalPort 5173 `
    -State Listen `
    -ErrorAction SilentlyContinue

$processIds = $frontend |
    Select-Object -ExpandProperty OwningProcess -Unique

foreach ($processId in $processIds) {
    Write-Host "Stopping frontend PID $processId..."
    taskkill /PID $processId /T /F
}

Write-Host "Service Monitor stop requested."