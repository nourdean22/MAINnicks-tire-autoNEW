# =============================================================================
# start-dev.ps1
#
# Starts both the Next.js dev server (pnpm dev) and a Cloudflare quick tunnel
# in parallel. Captures the tunnel URL to:
#   $env:USERPROFILE\.cloudflared\tunnel-url.txt
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts\start-dev.ps1
# Stop:  Ctrl+C (gracefully kills both processes)
# =============================================================================

$ErrorActionPreference = "Stop"

$CloudflaredPath = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
$UrlFile = Join-Path $env:USERPROFILE ".cloudflared\tunnel-url.txt"
$LogFile = Join-Path $env:USERPROFILE ".cloudflared\quick-tunnel.log"
$ProjectDir = Split-Path -Parent $PSScriptRoot

if (-not (Test-Path $CloudflaredPath)) {
    Write-Host "[ERROR] cloudflared not found at $CloudflaredPath" -ForegroundColor Red
    exit 1
}

# Track child processes for cleanup
$script:DevProcess = $null
$script:TunnelProcess = $null

function Cleanup {
    Write-Host ""
    Write-Host "[INFO] Shutting down..." -ForegroundColor Yellow

    if ($script:DevProcess -and -not $script:DevProcess.HasExited) {
        Write-Host "[INFO] Stopping dev server (PID $($script:DevProcess.Id))..."
        try {
            Stop-Process -Id $script:DevProcess.Id -Force -ErrorAction SilentlyContinue
            # Also kill any child node processes spawned by pnpm
            Get-CimInstance Win32_Process |
                Where-Object { $_.ParentProcessId -eq $script:DevProcess.Id } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        } catch {}
    }

    if ($script:TunnelProcess -and -not $script:TunnelProcess.HasExited) {
        Write-Host "[INFO] Stopping tunnel (PID $($script:TunnelProcess.Id))..."
        try {
            Stop-Process -Id $script:TunnelProcess.Id -Force -ErrorAction SilentlyContinue
        } catch {}
    }

    # Update URL file to reflect shutdown
    @"
mode=none
url=
stopped=$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@ | Set-Content -Path $UrlFile -Encoding UTF8

    Write-Host "[INFO] All processes stopped." -ForegroundColor Green
}

# Register cleanup for Ctrl+C and script exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action { Cleanup } | Out-Null
trap { Cleanup; break }

# ---- Start Dev Server ----
Write-Host "[INFO] Starting dev server (pnpm dev)..." -ForegroundColor Cyan

$script:DevProcess = Start-Process -FilePath "pnpm" `
    -ArgumentList "dev" `
    -WorkingDirectory $ProjectDir `
    -PassThru `
    -NoNewWindow

if (-not $script:DevProcess) {
    Write-Host "[ERROR] Failed to start dev server" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Dev server started (PID $($script:DevProcess.Id))"

# Give the dev server a moment to bind to port 3000
Start-Sleep -Seconds 3

# ---- Start Quick Tunnel ----
Write-Host "[INFO] Starting Cloudflare quick tunnel..." -ForegroundColor Cyan

# Initialize URL file
@"
mode=quick
url=pending
started=$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@ | Set-Content -Path $UrlFile -Encoding UTF8

# Clear previous log
"" | Set-Content -Path $LogFile -Encoding UTF8

$script:TunnelProcess = Start-Process -FilePath $CloudflaredPath `
    -ArgumentList "tunnel", "--url", "http://localhost:3000" `
    -PassThru `
    -NoNewWindow `
    -RedirectStandardError $LogFile

if (-not $script:TunnelProcess) {
    Write-Host "[ERROR] Failed to start tunnel" -ForegroundColor Red
    Cleanup
    exit 1
}

Write-Host "[INFO] Tunnel process started (PID $($script:TunnelProcess.Id))"

# ---- Capture Tunnel URL ----
Write-Host "[INFO] Waiting for tunnel URL..." -ForegroundColor Yellow

$TunnelUrl = $null
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1

    if ($script:TunnelProcess.HasExited) {
        Write-Host "[ERROR] Tunnel process exited unexpectedly. Check $LogFile" -ForegroundColor Red
        Cleanup
        exit 1
    }

    if (Test-Path $LogFile) {
        $logContent = Get-Content -Path $LogFile -Raw -ErrorAction SilentlyContinue
        if ($logContent -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
            $TunnelUrl = $Matches[0]
            break
        }
    }
}

if (-not $TunnelUrl) {
    Write-Host "[ERROR] Timed out waiting for tunnel URL after 30s" -ForegroundColor Red
    Write-Host "[ERROR] Check $LogFile" -ForegroundColor Red
    Cleanup
    exit 1
}

# Write final URL
@"
mode=quick
url=$TunnelUrl
started=$(Get-Date -Format "yyyy-MM-dd HH:mm:ss")
"@ | Set-Content -Path $UrlFile -Encoding UTF8

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DEV ENVIRONMENT ACTIVE" -ForegroundColor Green
Write-Host "  Local:  http://localhost:3000" -ForegroundColor White
Write-Host "  Tunnel: $TunnelUrl" -ForegroundColor White
Write-Host "  URL saved to: $UrlFile" -ForegroundColor Gray
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop both processes." -ForegroundColor Yellow
Write-Host ""

# ---- Keep alive and monitor ----
try {
    while ($true) {
        Start-Sleep -Seconds 5

        if ($script:DevProcess.HasExited) {
            Write-Host "[WARN] Dev server exited (code $($script:DevProcess.ExitCode))" -ForegroundColor Yellow
            Cleanup
            exit $script:DevProcess.ExitCode
        }

        if ($script:TunnelProcess.HasExited) {
            Write-Host "[WARN] Tunnel process exited (code $($script:TunnelProcess.ExitCode))" -ForegroundColor Yellow
            Write-Host "[INFO] Dev server still running at http://localhost:3000" -ForegroundColor Cyan
            # Continue running with just the dev server
        }
    }
} finally {
    Cleanup
}
