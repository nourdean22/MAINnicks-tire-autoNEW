# migrate-with-env.ps1
# Loads .env.local vars into shell then runs Prisma migrate
# Required because prisma.config.ts skips .env loading

param(
    [string]$Name = "migration",
    [switch]$Push,
    [switch]$Generate
)

# Try script-relative path first, fall back to current directory
$envFile = Join-Path (Join-Path $PSScriptRoot "..") ".env.local"
if (-not $envFile -or -not (Test-Path $envFile)) {
    $envFile = Join-Path (Get-Location) ".env.local"
}

if (-not (Test-Path $envFile)) {
    Write-Error ".env.local not found at $envFile"
    exit 1
}

Write-Host "Loading environment from .env.local..." -ForegroundColor Cyan

Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
        $parts = $line -split '=', 2
        $key = $parts[0].Trim()
        $val = $parts[1].Trim().Trim('"').Trim("'")
        # Strip literal \n that Vercel env pull adds
        $val = $val -replace '\\n$', ''
        [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        Write-Host "  Set $key" -ForegroundColor DarkGray
    }
}

Set-Location (Join-Path $PSScriptRoot "..")

if ($Push) {
    Write-Host "`nRunning prisma db push..." -ForegroundColor Yellow
    npx prisma db push
} elseif ($Generate) {
    Write-Host "`nRunning prisma generate..." -ForegroundColor Yellow
    npx prisma generate
} else {
    Write-Host "`nRunning prisma migrate dev --name $Name..." -ForegroundColor Yellow
    npx prisma migrate dev --name $Name
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nRunning prisma generate..." -ForegroundColor Yellow
    npx prisma generate
    Write-Host "`nDone!" -ForegroundColor Green
} else {
    Write-Host "`nMigration failed!" -ForegroundColor Red
    exit 1
}
