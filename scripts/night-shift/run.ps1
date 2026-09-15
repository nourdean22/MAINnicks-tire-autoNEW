<#
.SYNOPSIS
  Night Shift — one unattended Claude Code run that proposes ONE scoped PR.

.DESCRIPTION
  1. Fresh worktree via scripts/worktree-setup.ps1 (junctions, env copy)
  2. `claude -p` (headless) with scripts/night-shift/PROMPT.md
  3. Records the run (and the PR url, if one was opened) to the Reality Ledger
  4. Tears the worktree down

  Never merges. The prompt forbids it, the evaluator-separation CI job fails a
  candidate branch that edits its judges, and root AGENTS.md's protected
  operations cover the rest. The operator merges — or doesn't.

  Requires: `claude` on PATH and logged in; `gh` authenticated; env
  STATENOUR_SYNC_URL + STATENOUR_SYNC_KEY (the ledger door). Register it with
  register-task.ps1; run it by hand first.

.PARAMETER Model
  Model for the headless run. Default: the CLI default.
.PARAMETER MaxTurns
  Hard cap on agent turns — the run ends with no PR rather than looping.
#>
param(
  [string]$Model = "",
  [int]$MaxTurns = 80,
  [string]$RepoRoot = "C:\Users\nourd\NOURCITY"
)
$ErrorActionPreference = "Stop"
$date = Get-Date -Format "yyyy-MM-dd"
$branch = "night-shift/$date"
$wtName = "night-shift-$date"
$wtDir = Join-Path $RepoRoot ".worktrees\$wtName"
$logDir = Join-Path $RepoRoot "scripts\night-shift\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$date.log"

function Post-Ledger([hashtable]$event) {
  if (-not $env:STATENOUR_SYNC_URL -or -not $env:STATENOUR_SYNC_KEY) { return }
  try {
    $body = @{ events = @($event); sender = "night-shift" } | ConvertTo-Json -Depth 8
    Invoke-RestMethod -Method Post -Uri "$($env:STATENOUR_SYNC_URL.TrimEnd('/'))/api/sync/evidence" `
      -Headers @{ "x-sync-key" = $env:STATENOUR_SYNC_KEY; "content-type" = "application/json" } -Body $body -TimeoutSec 15 | Out-Null
  } catch { Add-Content $log "ledger post failed: $($_.Exception.Message)" }
}

Add-Content $log "=== night shift $date start $(Get-Date -Format o)"
Push-Location $RepoRoot
try {
  git fetch origin main 2>&1 | Add-Content $log
  if (Test-Path $wtDir) { throw "worktree $wtDir already exists — a previous run did not tear down; inspect it before re-running" }
  powershell -NoProfile -File scripts\worktree-setup.ps1 -branchName $branch -targetDir ".worktrees\$wtName" 2>&1 | Add-Content $log

  Push-Location $wtDir
  try {
    $prompt = Get-Content (Join-Path $RepoRoot "scripts\night-shift\PROMPT.md") -Raw
    $args = @("-p", $prompt, "--max-turns", "$MaxTurns", "--output-format", "json")
    if ($Model) { $args += @("--model", $Model) }
    Add-Content $log "claude $($args[2..($args.Length-1)] -join ' ')"
    $out = & claude @args 2>&1
    $out | Add-Content $log
    $prUrl = ($out | Select-String -Pattern "https://github\.com/[^\s\"']+/pull/\d+" -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1)
    $headSha = (git rev-parse HEAD).Trim()
    Post-Ledger @{
      eventType  = $(if ($prUrl) { "darwin.proposal_opened" } else { "darwin.no_proposal" })
      observedAt = (Get-Date).ToUniversalTime().ToString("o")
      objects    = @(@{ type = "branch"; id = $branch }, @{ type = "commit"; id = $headSha }) + $(if ($prUrl) { @(@{ type = "pr"; id = $prUrl }) } else { @() })
      source     = @{ system = "night-shift"; uri = $log }
      quality    = "observed"
      privacy    = "internal"
      payload    = @{ maxTurns = $MaxTurns; prUrl = $prUrl }
    }
    Add-Content $log "result: $(if ($prUrl) { $prUrl } else { 'no proposal' })"
  } finally { Pop-Location }
} finally {
  # Teardown removes junctions safely (never a bare recursive delete — they point OUT of the tree).
  if (Test-Path $wtDir) {
    powershell -NoProfile -File scripts\worktree-teardown.ps1 -targetDir ".worktrees\$wtName" 2>&1 | Add-Content $log
  }
  Pop-Location
  Add-Content $log "=== night shift $date end $(Get-Date -Format o)"
}
