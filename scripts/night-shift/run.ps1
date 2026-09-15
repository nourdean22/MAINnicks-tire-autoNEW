<#
.SYNOPSIS
  Night Shift - one unattended Claude Code run that proposes ONE scoped PR.

.DESCRIPTION
  1. Fresh worktree via scripts/worktree-setup.ps1 (junctions, env copy)
  2. `claude -p` (headless) with scripts/night-shift/PROMPT.md
  3. Records the run (and the PR url, if one was opened) to the Reality Ledger
  4. Tears the worktree down

  Never merges. The prompt forbids it, the evaluator-separation CI job fails a
  candidate branch that edits its judges, and root AGENTS.md's protected
  operations cover the rest. The operator merges - or doesn't.

  Requires: `claude` on PATH and logged in; `gh` authenticated; env
  STATENOUR_SYNC_URL + EVIDENCE_LEDGER_KEY (the SCOPED ledger key - it opens
  /api/sync/evidence and nothing else). Never hand this run STATENOUR_SYNC_KEY:
  that is the whole cross-app bridge (queue, nour-os, devices, cron/mega), and
  the headless agent inherits every variable in its environment. Without a
  ledger key the run still works; it just cannot read or post evidence.
  Register it with register-task.ps1; run it by hand first.

.PARAMETER Model
  Model for the headless run. Default: the CLI default.
.PARAMETER MaxTurns
  Hard cap on agent turns - the run ends with no PR rather than looping.
#>
param(
  [string]$Model = "",
  [int]$MaxTurns = 80,
  [string]$RepoRoot = "C:\Users\nourd\NOURCITY"
)
# ASCII ONLY in this file. register-task.ps1 runs it under Windows PowerShell 5.1, which
# reads a BOM-less file as cp1252: an em dash inside a double-quoted string decodes to a
# smart quote, which 5.1 accepts as a string terminator - the first launch died on exactly
# that ("The Try statement is missing its Catch or Finally block") while pwsh 7 parsed it
# clean. Check with: powershell.exe -NoProfile -Command "[Parser]::ParseFile(...)".
# NOT "Stop": git, worktree-setup and claude all write ordinary progress to stderr, and
# under Windows PowerShell 5.1 (what register-task.ps1 runs) "Stop" + `2>&1` turns the
# first such line into a terminating error. Failures are checked explicitly below.
$ErrorActionPreference = "Continue"
$date = Get-Date -Format "yyyy-MM-dd"
$branch = "night-shift/$date"
$wtName = "night-shift-$date"
$wtDir = Join-Path $RepoRoot ".worktrees\$wtName"
$logDir = Join-Path $RepoRoot "scripts\night-shift\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "$date.log"

function Post-Ledger([hashtable]$event) {
  if (-not $env:STATENOUR_SYNC_URL -or -not $env:EVIDENCE_LEDGER_KEY) { return }
  try {
    $body = @{ events = @($event); sender = "night-shift" } | ConvertTo-Json -Depth 8
    Invoke-RestMethod -Method Post -Uri "$($env:STATENOUR_SYNC_URL.TrimEnd('/'))/api/sync/evidence" `
      -Headers @{ "x-sync-key" = $env:EVIDENCE_LEDGER_KEY; "content-type" = "application/json" } -Body $body -TimeoutSec 15 | Out-Null
  } catch { Add-Content $log "ledger post failed: $($_.Exception.Message)" }
}

# The headless agent inherits this process's environment. The bridge key lives in
# the operator's user environment on this machine (local device agents use it), so
# scrub it here - process scope only, the user variable is untouched - and the
# agent holds exactly one credential: the scoped ledger key, if any.
$env:STATENOUR_SYNC_KEY = $null

Add-Content $log "=== night shift $date start $(Get-Date -Format o)"
Push-Location $RepoRoot
try {
  git fetch origin main 2>&1 | Add-Content $log
  if (Test-Path $wtDir) { throw "worktree $wtDir already exists - a previous run did not tear down; inspect it before re-running" }
  powershell -NoProfile -File scripts\worktree-setup.ps1 -branchName $branch -targetDir ".worktrees\$wtName" 2>&1 | Add-Content $log
  if (-not (Test-Path $wtDir)) { throw "worktree-setup did not create $wtDir - see $log" }
  if (-not (Test-Path (Join-Path $wtDir "node_modules"))) { throw "worktree $wtDir has no node_modules junction (pnpm-lock.yaml differs from origin/main under -RepoRoot?) - see $log" }

  Push-Location $wtDir
  try {
    $prompt = Get-Content (Join-Path $RepoRoot "scripts\night-shift\PROMPT.md") -Raw
    # Not `$args`: that is PowerShell's automatic parameter array.
    # --dangerously-skip-permissions: nobody answers a permission prompt at 02:30, and
    # without it every Bash/Edit call is denied and the night ends with "no proposal".
    # The guard is the agent-os PreToolUse hook (config/agent-os/policy.json): per the
    # Claude Code docs (hooks-guide, "Hooks and permission modes") PreToolUse fires
    # before any permission-mode check and a deny blocks the tool even under this flag;
    # and settings-file hooks are used even in a folder that was never trusted (only
    # permissions.allow / additionalDirectories are ignored there). Evaluator
    # separation CI and the push-to-main rule cover the rest.
    $claudeArgs = @("-p", $prompt, "--max-turns", "$MaxTurns", "--output-format", "json", "--dangerously-skip-permissions")
    if ($Model) { $claudeArgs += @("--model", $Model) }
    # Auth for an unattended run is CLAUDE_CODE_OAUTH_TOKEN (from `claude setup-token`,
    # one year, subscription). An interactive /login credential expires and cannot be
    # refreshed headless - the first run died on exactly that. Presence only, never the value.
    Add-Content $log "CLAUDE_CODE_OAUTH_TOKEN set: $([bool]$env:CLAUDE_CODE_OAUTH_TOKEN)"
    Add-Content $log "claude $($claudeArgs[2..($claudeArgs.Length-1)] -join ' ')"
    $out = & claude @claudeArgs 2>&1
    $claudeExit = $LASTEXITCODE
    Add-Content $log "claude exit: $claudeExit"
    $out | Add-Content $log
    $headSha = (git rev-parse HEAD).Trim()
    $objects = @(@{ type = "branch"; id = $branch }, @{ type = "commit"; id = $headSha })
    # A run that did not execute is not a night with no proposal. The first launch
    # died on an expired CLI login in 1.9 s; recording that as darwin.no_proposal
    # would have been false evidence that the agent read the inputs and declined.
    # The CLI's JSON result carries is_error/result on API and auth failures too.
    $outText = ($out | ForEach-Object { "$_" }) -join "`n"
    $isError = ($outText -match '"is_error"\s*:\s*true')
    if ($claudeExit -ne 0 -or $isError) {
      $reason = ($out | Select-String -Pattern '"result"\s*:\s*"([^"]{1,300})"' | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Last 1)
      if (-not $reason) { $reason = "claude exited $claudeExit" }
      Post-Ledger @{
        eventType  = "darwin.run_failed"
        observedAt = (Get-Date).ToUniversalTime().ToString("o")
        objects    = $objects
        source     = @{ system = "night-shift"; uri = $log }
        quality    = "observed"
        privacy    = "internal"
        payload    = @{ maxTurns = $MaxTurns; exitCode = $claudeExit; reason = $reason }
      }
      Add-Content $log "result: RUN FAILED (exit $claudeExit) - $reason"
      throw "night shift did not run: $reason"
    }
    # Single-quoted on purpose: a backslash does not escape a double quote inside a
    # double-quoted PowerShell string, so the old spelling ended the string early and
    # the whole file failed to parse (5 errors on origin/main, never runnable).
    $prUrl = ($out | Select-String -Pattern 'https://github\.com/[^\s"'']+/pull/\d+' -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -Last 1)
    Post-Ledger @{
      eventType  = $(if ($prUrl) { "darwin.proposal_opened" } else { "darwin.no_proposal" })
      observedAt = (Get-Date).ToUniversalTime().ToString("o")
      objects    = $objects + $(if ($prUrl) { @(@{ type = "pr"; id = $prUrl }) } else { @() })
      source     = @{ system = "night-shift"; uri = $log }
      quality    = "observed"
      privacy    = "internal"
      payload    = @{ maxTurns = $MaxTurns; prUrl = $prUrl }
    }
    Add-Content $log "result: $(if ($prUrl) { $prUrl } else { 'no proposal' })"
  } finally { Pop-Location }
} finally {
  # Teardown removes junctions safely (never a bare recursive delete - they point OUT of the tree).
  if (Test-Path $wtDir) {
    powershell -NoProfile -File scripts\worktree-teardown.ps1 -targetDir ".worktrees\$wtName" 2>&1 | Add-Content $log
  }
  Pop-Location
  Add-Content $log "=== night shift $date end $(Get-Date -Format o)"
}
