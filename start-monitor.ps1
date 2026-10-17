$root = $PSScriptRoot

Start-Process -FilePath "cmd.exe" `
    -ArgumentList '/c "start.bat"' `
    -WorkingDirectory "$root\backend"

Start-Process -FilePath "cmd.exe" `
    -ArgumentList '/c "start.bat"' `
    -WorkingDirectory "$root\frontend"

Write-Host "Service Monitor started."