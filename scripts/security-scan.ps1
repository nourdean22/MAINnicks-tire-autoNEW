<#
.SYNOPSIS
  Supply-chain security scan for NOURCITY monorepo.

.DESCRIPTION
  Runs `npm audit --json` across all workspace packages and produces
  a JSON report of vulnerabilities. Intended for CI (non-blocking) and
  local dev. Exits 0 even if findings exist — the report is informational
  and the CI step is advisory-only.

  Output: JSON to stdout (pipe to file if needed).

.EXAMPLE
  # Run from repo root:
  powershell scripts/security-scan.ps1
  powershell scripts/security-scan.ps1 -OutputFile reports/audit.json
  powershell scripts/security-scan.ps1 -Severity critical

.PARAMETER OutputFile
  Optional. File path to write the JSON report. If not specified, prints
  to stdout.

.PARAMETER Severity
  Optional. Minimum severity to report: info, low, moderate, high, critical.
  Default: moderate.

.PARAMETER FailOnCritical
  Optional. If set, the script exits with code 1 when critical vulns found.
  Default: $false (advisory-only).
#>
param(
  [string]$OutputFile = "",
  [ValidateSet("info","low","moderate","high","critical")]
  [string]$Severity = "moderate",
  [switch]$FailOnCritical
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[security-scan] Running npm audit (severity >= $Severity)..." -ForegroundColor Cyan

# npm audit returns non-zero when vulns found — we capture and parse
try {
  $auditRaw = npm audit --json --audit-level=$Severity 2>&1
  $exitCode = $LASTEXITCODE
} catch {
  $auditRaw = $_.Exception.Message
  $exitCode = 1
}

# Build structured report
$timestamp = Get-Date -Format "o"
$report = @{
  timestamp = $timestamp
  repoRoot  = $repoRoot
  severity  = $Severity
  exitCode  = $exitCode
  raw       = $auditRaw -join "`n"
}

# Try to parse the JSON output for summary
try {
  $parsed = $auditRaw | ConvertFrom-Json
  $report["vulnerabilities"] = @{
    total    = ($parsed.metadata.vulnerabilities | Get-Member -MemberType NoteProperty | ForEach-Object {
      $parsed.metadata.vulnerabilities.$($_.Name)
    } | Measure-Object -Sum).Sum
    info     = $parsed.metadata.vulnerabilities.info
    low      = $parsed.metadata.vulnerabilities.low
    moderate = $parsed.metadata.vulnerabilities.moderate
    high     = $parsed.metadata.vulnerabilities.high
    critical = $parsed.metadata.vulnerabilities.critical
  }
  $report["dependencies"] = $parsed.metadata.dependencies
} catch {
  $report["parseError"] = "Could not parse npm audit JSON output"
}

$jsonReport = $report | ConvertTo-Json -Depth 5

if ($OutputFile) {
  $dir = Split-Path -Parent $OutputFile
  if ($dir -and -not (Test-Path $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  $jsonReport | Out-File -FilePath $OutputFile -Encoding UTF8
  Write-Host "[security-scan] Report written to $OutputFile" -ForegroundColor Green
} else {
  Write-Output $jsonReport
}

# Summary
$critCount = 0
try {
  $critCount = $report["vulnerabilities"]["critical"]
} catch {}

if ($critCount -gt 0) {
  Write-Host "[security-scan] CRITICAL: $critCount critical vulnerabilities found!" -ForegroundColor Red
  if ($FailOnCritical) {
    exit 1
  }
} else {
  Write-Host "[security-scan] No critical vulnerabilities found." -ForegroundColor Green
}

Write-Host "[security-scan] Done." -ForegroundColor Cyan
exit 0
