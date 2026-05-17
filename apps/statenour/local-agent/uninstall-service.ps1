# uninstall-service.ps1 — Remove statenour-agent Windows service
# Run as Administrator

$ServiceName = "statenour-agent"

Write-Host "Stopping $ServiceName..." -ForegroundColor Yellow
nssm stop $ServiceName 2>$null

Write-Host "Removing $ServiceName..." -ForegroundColor Yellow
nssm remove $ServiceName confirm

Write-Host "Done. Service removed." -ForegroundColor Green
