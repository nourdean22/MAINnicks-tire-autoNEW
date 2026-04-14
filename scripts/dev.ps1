# ═══════════════════════════════════════════════════════════════
# NICKSTIRE LOCAL DEV — standalone startup (no Claude)
# ═══════════════════════════════════════════════════════════════
#
# ⚠ IF YOU'RE USING CLAUDE CODE / CLAUDE PREVIEW MCP: you don't need
#   this script. Just call `preview_start({name: "Nickstire"})` in
#   Claude — it launches dev-server-wrapper.mjs automatically which
#   handles everything below.
#
# This script is for running nickstire dev WITHOUT Claude:
#   1. Kills any zombie node processes on ports 3500-3504
#   2. Verifies .env exists (pulls from Railway if missing)
#   3. Starts tsx watch on port 3500 (direct, no wrapper — you own the shell)
#   4. Opens http://localhost:3500/api/dev/signin in default browser
#      (mints session cookie + redirects to /admin — no Google OAuth needed)
#
# Usage:   pwsh scripts/dev.ps1
# ═══════════════════════════════════════════════════════════════

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

Write-Host ""
Write-Host "═══ NICKSTIRE DEV STARTUP ═══" -ForegroundColor Cyan
Write-Host ""

# ─── 1. Kill zombies ─────────────────────────────────
Write-Host "→ Killing zombie processes on ports 3500-3504..." -ForegroundColor Yellow
foreach ($port in 3500..3504) {
    Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Seconds 1
Write-Host "  ✓ Ports clear" -ForegroundColor Green

# ─── 2. Verify .env ───────────────────────────────────
if (-not (Test-Path ".env")) {
    Write-Host "→ No .env found — pulling from Railway..." -ForegroundColor Yellow
    $railway = "$env:APPDATA\npm\railway.cmd"
    if (-not (Test-Path $railway)) {
        Write-Host "  ✗ Railway CLI not installed. Run: npm i -g @railway/cli" -ForegroundColor Red
        exit 1
    }
    & $railway variables list --kv > .env
    Add-Content .env ""
    Add-Content .env "# Local dev overrides"
    Add-Content .env "NODE_ENV=development"
    Add-Content .env "PORT=3500"
    Write-Host "  ✓ .env created" -ForegroundColor Green
} else {
    Write-Host "  ✓ .env exists" -ForegroundColor Green
}

# ─── 3. Start tsx watch in background ────────────────
Write-Host "→ Starting tsx watch on port 3500..." -ForegroundColor Yellow
$env:NODE_ENV = "development"
$env:PORT = "3500"

$proc = Start-Process -FilePath "pnpm" -ArgumentList "exec","tsx","watch","server/_core/index.ts" `
    -NoNewWindow -PassThru -RedirectStandardOutput "logs/dev-server.log" -RedirectStandardError "logs/dev-server-err.log"

if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

# Wait for server to respond
Write-Host "  → waiting for server to be ready (up to 90s)..." -ForegroundColor DarkGray
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:3500/api/ping" -TimeoutSec 2 -ErrorAction Stop
        if ($r.StatusCode -eq 200) { $ready = $true; break }
    } catch { }
}

if ($ready) {
    Write-Host "  ✓ Server ready (PID $($proc.Id))" -ForegroundColor Green
} else {
    Write-Host "  ✗ Server did not become ready in 90s — check logs/dev-server.log" -ForegroundColor Red
    exit 1
}

# ─── 4. Sign in + open admin ─────────────────────────
Write-Host "→ Opening /api/dev/signin (mints cookie, redirects to /admin)..." -ForegroundColor Yellow
Start-Process "http://localhost:3500/api/dev/signin"

Write-Host ""
Write-Host "═══ READY ═══" -ForegroundColor Cyan
Write-Host "  Server:  http://localhost:3500" -ForegroundColor White
Write-Host "  Admin:   http://localhost:3500/admin" -ForegroundColor White
Write-Host "  Logs:    tail -f logs/dev-server.log" -ForegroundColor DarkGray
Write-Host "  Stop:    Stop-Process -Id $($proc.Id)" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Press Ctrl+C here to stop watching (server keeps running)" -ForegroundColor DarkGray
Get-Content "logs/dev-server.log" -Wait -Tail 0
