param(
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $Root

# Prefer Git Bash over the Windows WSL bash shim for repo shell canaries.
$gitBashDir = "C:\Program Files\Git\bin"
if (Test-Path (Join-Path $gitBashDir "bash.exe")) {
  $env:Path = "$gitBashDir;$env:Path"
}

Write-Host "[bootstrap] repo=$Root"
Write-Host "[bootstrap] node=$(node --version)"

$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 24) {
  throw "Node 24+ required"
}

foreach ($cmd in @("git", "corepack")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "$cmd missing"
  }
}

$pnpmVersion = (corepack pnpm --version).Trim()
Write-Host "[bootstrap] pnpm=$pnpmVersion"

if ($Install) {
  Write-Host "[bootstrap] installing locked workspace dependencies"
  corepack pnpm install --frozen-lockfile
}

node scripts/dev/doctor.mjs
if ($LASTEXITCODE -ne 0) {
  throw "doctor failed with exit $LASTEXITCODE"
}

if ($Install) {
  Write-Host "[bootstrap] running cross-agent policy verification"
  corepack pnpm agent:verify
  if ($LASTEXITCODE -ne 0) {
    throw "agent verification failed with exit $LASTEXITCODE"
  }
}

Write-Host "[bootstrap] complete"
