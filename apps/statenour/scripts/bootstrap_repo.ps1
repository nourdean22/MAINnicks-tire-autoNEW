[CmdletBinding()]
param(
  [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-Status {
  param(
    [bool]$Condition,
    [string]$PassStatus = "PASS",
    [string]$FailStatus = "BLOCKED"
  )

  if ($Condition) {
    return $PassStatus
  }

  return $FailStatus
}

function Ensure-Directory {
  param(
    [string]$Path,
    [switch]$Preview
  )

  if (Test-Path -LiteralPath $Path) {
    return "present"
  }

  if ($Preview) {
    return "planned"
  }

  New-Item -ItemType Directory -Path $Path -Force | Out-Null
  return "created"
}

function Write-JsonFile {
  param(
    [string]$Path,
    [object]$Value
  )

  $json = $Value | ConvertTo-Json -Depth 8
  Set-Content -LiteralPath $Path -Value ($json + [Environment]::NewLine) -Encoding UTF8
}

function Write-MarkdownFile {
  param(
    [string]$Path,
    [string]$Content
  )

  Set-Content -LiteralPath $Path -Value $Content -Encoding UTF8
}

$scriptRoot = Split-Path -Parent $PSCommandPath
$repoRoot = Split-Path -Parent $scriptRoot
$timestamp = (Get-Date).ToString("o")

$requiredFiles = @(
  ".env.example",
  "package.json",
  "README.md",
  "prisma/schema.prisma",
  "app/page.tsx",
  "app/system/page.tsx"
)

$evidenceDirectories = @(
  "reports",
  "logs",
  "handoffs",
  "data",
  "data/redacted"
)

$packageJsonPath = Join-Path $repoRoot "package.json"
$packageJson = Get-Content -LiteralPath $packageJsonPath -Raw | ConvertFrom-Json
$requiredScripts = @("dev", "build", "lint", "typecheck", "test", "bootstrap:repo")
$packageScriptNames = @($packageJson.scripts.PSObject.Properties.Name)
$missingScripts = @($requiredScripts | Where-Object { $_ -notin $packageScriptNames })

$requiredFileResults = foreach ($relativePath in $requiredFiles) {
  $fullPath = Join-Path $repoRoot $relativePath
  $exists = Test-Path -LiteralPath $fullPath
  [pscustomobject]@{
    path = $relativePath
    exists = [bool]$exists
    status = Get-Status -Condition $exists -PassStatus "PASS" -FailStatus "BLOCKED"
  }
}

$directoryResults = foreach ($relativePath in $evidenceDirectories) {
  $fullPath = Join-Path $repoRoot $relativePath
  [pscustomobject]@{
    path = $relativePath
    action = Ensure-Directory -Path $fullPath -Preview:$DryRun
  }
}

$envExamplePath = Join-Path $repoRoot ".env.example"
$envKeys = @()
if (Test-Path -LiteralPath $envExamplePath) {
  $envKeys = @(
    Get-Content -LiteralPath $envExamplePath |
      Where-Object { $_ -match '^[A-Z0-9_]+=' } |
      ForEach-Object { ($_ -split '=', 2)[0] }
  )
}

$outsideRepoDependencyFiles = @(
  "README.md",
  "auth.ts"
)
$outsideRepoDependencyRoots = @(
  (Join-Path $repoRoot "app"),
  (Join-Path $repoRoot "lib")
)

$outsideRepoReferences = @()
foreach ($root in $outsideRepoDependencyRoots) {
  if (Test-Path -LiteralPath $root) {
    $outsideRepoReferences += Get-ChildItem -Path $root -Recurse -File |
      Select-String -Pattern 'C:\\NOUR_OS' -SimpleMatch |
      Select-Object -ExpandProperty Path -Unique
  }
}

foreach ($relativeFile in $outsideRepoDependencyFiles) {
  $filePath = Join-Path $repoRoot $relativeFile
  if (Test-Path -LiteralPath $filePath) {
    $outsideRepoReferences += Select-String -Path $filePath -Pattern 'C:\\NOUR_OS' -SimpleMatch |
      Select-Object -ExpandProperty Path -Unique
  }
}

$outsideRepoReferences = @(
  $outsideRepoReferences |
    Sort-Object -Unique |
    ForEach-Object { $_.Replace($repoRoot + "\", "") }
)

$missingRequiredFiles = @($requiredFileResults | Where-Object { -not $_.exists } | ForEach-Object { $_.path })
$nodeModulesPresent = Test-Path -LiteralPath (Join-Path $repoRoot "node_modules")
$envLocalPresent = Test-Path -LiteralPath (Join-Path $repoRoot ".env.local")

$overallStatus = if ($missingRequiredFiles.Count -gt 0) {
  "BLOCKED"
} elseif ($missingScripts.Count -gt 0) {
  "PARTIAL"
} elseif ($outsideRepoReferences.Count -gt 0) {
  "PASS_WITH_FALLBACK"
} else {
  "PASS"
}

$nextAction = switch ($overallStatus) {
  "BLOCKED" { "Restore missing required repo files before expanding the spine." }
  "PARTIAL" { "Restore missing package scripts before expanding the spine." }
  "PASS_WITH_FALLBACK" { "Repo-local bootstrap is healthy, but outside-repo dependencies still require separate verification." }
  default { "Repo-local bootstrap is healthy. Continue into the next justified foundation layer." }
}

$reportJsonPath = Join-Path $repoRoot "reports\bootstrap_status.json"
$reportMdPath = Join-Path $repoRoot "reports\bootstrap_status.md"

$report = [ordered]@{
  generated_at = $timestamp
  repo_root = $repoRoot
  dry_run = [bool]$DryRun
  status = $overallStatus
  summary = "Repo-local bootstrap and evidence-path preflight."
  required_files = $requiredFileResults
  missing_required_files = $missingRequiredFiles
  required_scripts = $requiredScripts
  missing_scripts = $missingScripts
  env_example_keys = $envKeys
  env_local_present = $envLocalPresent
  node_modules_present = $nodeModulesPresent
  evidence_directories = $directoryResults
  outside_repo_references = $outsideRepoReferences
  next_action = $nextAction
}

$requiredFileRows = ($requiredFileResults | ForEach-Object { "| $($_.path) | $($_.exists) | $($_.status) |" }) -join [Environment]::NewLine
$directoryRows = ($directoryResults | ForEach-Object { "| $($_.path) | $($_.action) |" }) -join [Environment]::NewLine
$outsideRepoSection = if ($outsideRepoReferences.Count -gt 0) {
  ($outsideRepoReferences | ForEach-Object { "- $_" }) -join [Environment]::NewLine
} else {
  "- none detected"
}

$markdown = @"
# Bootstrap Status

Date: $timestamp
Mode: $(if ($DryRun) { "dry-run" } else { "apply" })

## Summary

- Status: $overallStatus
- Repo root: $repoRoot
- .env.local present: $envLocalPresent
- node_modules present: $nodeModulesPresent
- Next action: $nextAction

## Required Files

| Path | Exists | Status |
|---|---:|---|
$requiredFileRows

## Required Scripts

- Present: $(($requiredScripts | Where-Object { $_ -notin $missingScripts }) -join ", ")
- Missing: $(if ($missingScripts.Count -gt 0) { $missingScripts -join ", " } else { "none" })

## Evidence Directories

| Path | Action |
|---|---|
$directoryRows

## Outside-Repo Dependencies

$outsideRepoSection
"@

Write-JsonFile -Path $reportJsonPath -Value $report
Write-MarkdownFile -Path $reportMdPath -Content ($markdown.Trim() + [Environment]::NewLine)

Write-Output "Bootstrap status written to:"
Write-Output $reportMdPath
Write-Output $reportJsonPath
Write-Output "Overall status: $overallStatus"
