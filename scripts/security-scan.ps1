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

# pnpm audit returns non-zero when vulns found — we capture and parse.
# EAP must be Continue here: with "Stop", the first stderr line (e.g. a Node
# deprecation warning) throws and we lose the entire JSON payload on stdout.
$prevEap = $ErrorActionPreference
try {
  $ErrorActionPreference = "Continue"
  $auditRaw = pnpm audit --json --audit-level $Severity 2>&1
  $exitCode = $LASTEXITCODE
} catch {
  $auditRaw = $_.Exception.Message
  $exitCode = 1
} finally {
  $ErrorActionPreference = $prevEap
}

$rawText = ($auditRaw | ForEach-Object { "$_" }) -join "`n"

# Build structured report
$timestamp = Get-Date -Format "o"
$report = @{
  timestamp = $timestamp
  repoRoot  = $repoRoot
  severity  = $Severity
  exitCode  = $exitCode
}

$advisories = @()
$critCount = 0
$highCount = 0
$modCount  = 0
$lowCount  = 0
$parsedOk  = $false

# pnpm@10 emits ONE npm-style JSON document, often preceded by Node
# deprecation warnings (merged stderr). Locate the JSON payload by first
# brace instead of assuming the stream starts with '{'.
$jsonStart = $rawText.IndexOf('{')
if ($jsonStart -ge 0) {
  try {
    $parsed = $rawText.Substring($jsonStart) | ConvertFrom-Json
    if ($parsed.metadata -or $parsed.advisories) {
      if ($parsed.advisories) {
        foreach ($prop in $parsed.advisories.PSObject.Properties) {
          $adv = $prop.Value
          $advisories += @{
            id       = $adv.id
            title    = $adv.title
            severity = $adv.severity
            module   = $adv.module_name
            url      = $adv.url
            range    = $adv.vulnerable_versions
            patched  = $adv.patched_versions
          }
        }
      }
      if ($parsed.metadata.vulnerabilities) {
        $v = $parsed.metadata.vulnerabilities
        $critCount = [int]$v.critical
        $highCount = [int]$v.high
        $modCount  = [int]$v.moderate
        $lowCount  = [int]$v.low
        $report["dependencies"] = $parsed.metadata.dependencies
      } else {
        foreach ($a in $advisories) {
          switch ($a.severity) {
            "critical" { $critCount++ }
            "high"     { $highCount++ }
            "moderate" { $modCount++ }
            "low"      { $lowCount++ }
          }
        }
      }
      $parsedOk = $true
    }
  } catch {
    # fall through to NDJSON handling below
  }
}

# Legacy fallback: NDJSON (one JSON object per line, older pnpm/npm formats)
if (-not $parsedOk) {
  foreach ($line in ($rawText -split "`n")) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or -not $trimmed.StartsWith("{")) { continue }
    try {
      $obj = $trimmed | ConvertFrom-Json
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
        $parsedOk = $true
      }
      elseif ($obj.type -eq "auditSummary") {
        $report["summary"] = $obj.data
        $parsedOk = $true
      }
    } catch {
      # Non-JSON line, skip
    }
  }
}

# pnpm audit exits non-zero when vulnerabilities exist. If it exited
# non-zero and we parsed nothing, the scanner is blind — fail loudly
# instead of reporting a clean result.
if (-not $parsedOk -and $exitCode -ne 0) {
  $report["parseError"] = $true
  Write-Host "[security-scan] ERROR: pnpm audit exited $exitCode but its output could not be parsed." -ForegroundColor Red
  Write-Host "[security-scan] Refusing to report a clean result. Raw output head:" -ForegroundColor Red
  Write-Host ($rawText.Substring(0, [Math]::Min(800, $rawText.Length)))
  exit 1
}

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
