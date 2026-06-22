<#
.SYNOPSIS
  Supply-chain security scan for NOURCITY monorepo.

.DESCRIPTION
  Runs `pnpm audit --json` across all workspace packages and produces
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
  Optional. Minimum severity to report: low, moderate, high, critical.
  Default: moderate.

.PARAMETER FailOnCritical
  Optional. If set, the script exits with code 1 when critical vulns found.
  Default: $false (advisory-only).
#>
param(
  [string]$OutputFile = "",
  [ValidateSet("low","moderate","high","critical")]
  [string]$Severity = "moderate",
  [switch]$FailOnCritical
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

Write-Host "[security-scan] Running pnpm audit (severity >= $Severity)..." -ForegroundColor Cyan

# pnpm audit returns non-zero when vulns found — we capture and parse
try {
  $auditRaw = pnpm audit --json --audit-level $Severity 2>&1
  $exitCode = $LASTEXITCODE
} catch {
  $auditRaw = $_.Exception.Message
  $exitCode = 1
}

$rawText = $auditRaw -join "`n"

# Build structured report
$timestamp = Get-Date -Format "o"
$report = @{
  timestamp = $timestamp
  repoRoot  = $repoRoot
  severity  = $Severity
  exitCode  = $exitCode
}

# pnpm audit --json outputs NDJSON (one JSON object per advisory)
# Collect all advisories into an array
$advisories = @()
$critCount = 0
$highCount = 0
$modCount  = 0
$lowCount  = 0

foreach ($line in ($rawText -split "`n")) {
  $trimmed = $line.Trim()
  if (-not $trimmed -or -not $trimmed.StartsWith("{")) { continue }
  try {
    $obj = $trimmed | ConvertFrom-Json
    # pnpm audit JSON lines have a "type" field
    if ($obj.type -eq "auditAdvisory") {
      $adv = $obj.data.advisory
      $advisories += @{
        id       = $adv.id
        title    = $adv.title
        severity = $adv.severity
        module   = $adv.module_name
        url      = $adv.url
        range    = $adv.vulnerable_versions
      }
      switch ($adv.severity) {
        "critical" { $critCount++ }
        "high"     { $highCount++ }
        "moderate" { $modCount++ }
        "low"      { $lowCount++ }
      }
    }
    elseif ($obj.type -eq "auditSummary") {
      $report["summary"] = $obj.data
    }
  } catch {
    # Non-JSON line, skip
  }
}

# If no NDJSON parsed, try standard npm-style JSON
if ($advisories.Count -eq 0 -and $rawText.Trim().StartsWith("{")) {
  try {
    $parsed = $rawText | ConvertFrom-Json
    if ($parsed.metadata) {
      $report["vulnerabilities"] = @{
        total    = $parsed.metadata.vulnerabilities.total
        info     = if ($parsed.metadata.vulnerabilities.info) { $parsed.metadata.vulnerabilities.info } else { 0 }
        low      = if ($parsed.metadata.vulnerabilities.low) { $parsed.metadata.vulnerabilities.low } else { 0 }
        moderate = if ($parsed.metadata.vulnerabilities.moderate) { $parsed.metadata.vulnerabilities.moderate } else { 0 }
        high     = if ($parsed.metadata.vulnerabilities.high) { $parsed.metadata.vulnerabilities.high } else { 0 }
        critical = if ($parsed.metadata.vulnerabilities.critical) { $parsed.metadata.vulnerabilities.critical } else { 0 }
      }
      $critCount = $report["vulnerabilities"]["critical"]
      $highCount = $report["vulnerabilities"]["high"]
      $modCount  = $report["vulnerabilities"]["moderate"]
      $lowCount  = $report["vulnerabilities"]["low"]
      $report["dependencies"] = $parsed.metadata.dependencies
    }
  } catch {
    # Fallback: just store raw
  }
}

# Always store counts
$report["vulnerabilities"] = @{
  critical = $critCount
  high     = $highCount
  moderate = $modCount
  low      = $lowCount
  total    = $critCount + $highCount + $modCount + $lowCount
}
$report["advisories"] = $advisories

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

# Summary table
Write-Host ""
Write-Host "[security-scan] Results:" -ForegroundColor White
Write-Host "  Critical:  $critCount" -ForegroundColor $(if ($critCount -gt 0) { "Red" } else { "Green" })
Write-Host "  High:      $highCount" -ForegroundColor $(if ($highCount -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Moderate:  $modCount" -ForegroundColor $(if ($modCount -gt 0) { "Yellow" } else { "Green" })
Write-Host "  Low:       $lowCount" -ForegroundColor Gray
Write-Host "  Total:     $($critCount + $highCount + $modCount + $lowCount)" -ForegroundColor White
Write-Host ""

if ($critCount -gt 0) {
  Write-Host "[security-scan] CRITICAL: $critCount critical vulnerabilities found!" -ForegroundColor Red
  if ($FailOnCritical) {
    exit 1
  }
} else {
  Write-Host "[security-scan] No critical vulnerabilities." -ForegroundColor Green
}

Write-Host "[security-scan] Done." -ForegroundColor Cyan
exit 0
