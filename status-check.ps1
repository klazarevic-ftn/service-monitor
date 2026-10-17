$apps = @(
    @{ Name = "Keycloak";          Port = 8080 }
    @{ Name = "User Service";      Port = 8081 }
    @{ Name = "Studies Service";   Port = 8082 }
    @{ Name = "Scheduling Service";Port = 8083 }
    @{ Name = "Assessment Service";Port = 8084 }
    @{ Name = "Payment Service";   Port = 8085 }
    @{ Name = "File Service";      Port = 8086 }

    @{ Name = "Monitor Backend";   Port = 3000 }
    @{ Name = "Monitor Frontend";  Port = 5173 }
    @{ Name = "Angular Frontend";  Port = 4200 }

    @{ Name = "PostgreSQL";        Port = 5432 }
    @{ Name = "RustFS";            Port = 9000 }
)

Write-Host "`n=== SERVER STATUS ===`n"

foreach ($app in $apps) {
    $connections = @(
        Get-NetTCPConnection `
            -LocalPort $app.Port `
            -State Listen `
            -ErrorAction SilentlyContinue
    )

    if ($connections.Count -gt 0) {
        $pids = @(
            $connections |
                Select-Object -ExpandProperty OwningProcess -Unique
        )

        foreach ($processId in $pids) {
            $process = Get-Process -Id $processId -ErrorAction SilentlyContinue

            $processName = if ($process) {
                $process.ProcessName
            } else {
                "Unknown"
            }

            Write-Host (
                "[RUNNING] {0,-20} Port: {1,-5} PID: {2,-7} Process: {3}" -f `
                $app.Name, $app.Port, $processId, $processName
            ) -ForegroundColor Green
        }
    }
    else {
        Write-Host (
            "[OFFLINE] {0,-20} Port: {1}" -f `
            $app.Name, $app.Port
        ) -ForegroundColor DarkGray
    }
}

Write-Host "`n=====================`n"