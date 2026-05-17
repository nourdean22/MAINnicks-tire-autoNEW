# install-service.ps1 — Install statenour-agent as a Windows service via NSSM
# Run as Administrator

$ServiceName = "statenour-agent"
$AgentDir = Split-Path -Parent $PSScriptRoot
$AgentDir = Join-Path $AgentDir "local-agent"
if (-not (Test-Path (Join-Path $AgentDir "agent.py"))) {
    $AgentDir = $PSScriptRoot
}
$PythonPath = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $PythonPath) { $PythonPath = "python" }
$LogDir = Join-Path $AgentDir "logs"

# Ensure log directory exists
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }

# Check if NSSM is installed
$nssm = Get-Command nssm -ErrorAction SilentlyContinue
if (-not $nssm) {
    Write-Host "NSSM not found. Installing via winget..." -ForegroundColor Yellow
    winget install nssm --accept-source-agreements --accept-package-agreements 2>$null
    $nssm = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $nssm) {
        Write-Host "NSSM not found. Install it manually: choco install nssm -or- winget install nssm" -ForegroundColor Red
        exit 1
    }
}

# Remove existing service if it exists
$existing = sc.exe query $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Removing existing $ServiceName service..." -ForegroundColor Yellow
    nssm stop $ServiceName 2>$null
    nssm remove $ServiceName confirm
}

Write-Host "Installing $ServiceName service..." -ForegroundColor Cyan
Write-Host "  Python: $PythonPath" -ForegroundColor DarkGray
Write-Host "  Script: $AgentDir\agent.py" -ForegroundColor DarkGray
Write-Host "  Logs:   $LogDir" -ForegroundColor DarkGray

# Install the service
nssm install $ServiceName $PythonPath "$AgentDir\agent.py"

# Configure service parameters
nssm set $ServiceName AppDirectory $AgentDir
nssm set $ServiceName DisplayName "Statenour OS Agent"
nssm set $ServiceName Description "Local smart home agent for statenour-os. Polls Tuya, Ring, Eufy, V380 devices."
nssm set $ServiceName Start SERVICE_AUTO_START

# Restart on failure (10 second delay)
nssm set $ServiceName AppExit Default Restart
nssm set $ServiceName AppRestartDelay 10000

# Log rotation
nssm set $ServiceName AppStdout "$LogDir\agent-stdout.log"
nssm set $ServiceName AppStderr "$LogDir\agent-stderr.log"
nssm set $ServiceName AppStdoutCreationDisposition 4
nssm set $ServiceName AppStderrCreationDisposition 4
nssm set $ServiceName AppRotateFiles 1
nssm set $ServiceName AppRotateSeconds 86400
nssm set $ServiceName AppRotateBytes 10485760

# Environment variables (load from .env)
$envFile = Join-Path $AgentDir ".env"
if (Test-Path $envFile) {
    $envVars = @()
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
            $envVars += $line
        }
    }
    if ($envVars.Count -gt 0) {
        $envString = $envVars -join "`n"
        nssm set $ServiceName AppEnvironmentExtra $envString
    }
}

# Start the service
Write-Host "`nStarting $ServiceName..." -ForegroundColor Green
nssm start $ServiceName

# Verify
Start-Sleep -Seconds 3
$status = sc.exe query $ServiceName 2>$null
if ($status -match "RUNNING") {
    Write-Host "`n$ServiceName is RUNNING" -ForegroundColor Green
    Write-Host "  Logs: $LogDir\agent-stdout.log" -ForegroundColor DarkGray
    Write-Host "  Health: http://localhost:3600/health" -ForegroundColor DarkGray
} else {
    Write-Host "`nService may not have started. Check logs at $LogDir" -ForegroundColor Yellow
    Write-Host "  Debug: nssm status $ServiceName" -ForegroundColor DarkGray
}
