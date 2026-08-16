<#
  Scheduled-task wrapper for the nightly brain archive.

  WHY A WRAPPER. Task Scheduler cannot invoke `pnpm` directly on this machine —
  it resolves to pnpm.ps1, not an .exe. It also needs a working directory, and it
  needs to fail LOUDLY: a scheduled job that silently no-ops is worse than no job,
  because the archive it was supposed to produce is missing exactly when someone
  needs it.

  WHY IT SELF-UPDATES. The primary checkout sits on a DETACHED HEAD (it was three
  weeks stale when this was written) because `main` is held by another worktree.
  A task pinned to a stale tree would run code that predates the script it is
  meant to run. The fast-forward is safe by construction: it only advances when
  HEAD is already an ancestor of origin/main, and refuses otherwise rather than
  merging.

  Every run appends to archive-run.log next to the archive, so a silent failure
  is still a visible one.
#>
param(
  [string]$RepoDir = "C:\Users\nourd\NOURCITY\apps\statenour",
  [string]$EnvFile = "C:\Users\nourd\NOURCITY\apps\statenour\.env"
)

$ErrorActionPreference = "Stop"
$vault = if ($env:OBSIDIAN_VAULT_PATH) { $env:OBSIDIAN_VAULT_PATH } else { "C:\Users\nourd\OneDrive\Documents\Obsidian Vault" }
$logDir = Join-Path $vault "Statenour\_archive"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "archive-run.log"

function Write-Log($msg) {
  $line = "{0}  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
  # -Encoding utf8: the export prints '·' and em dashes, and the default
  # encoding mangled them into '-+' and 'G??' in the log.
  Add-Content -Path $log -Value $line -Encoding utf8
  Write-Output $line
}

Write-Log "=== run start ==="

if (-not (Test-Path (Join-Path $RepoDir "package.json"))) {
  Write-Log "FATAL: no package.json at $RepoDir"
  exit 1
}

# Self-update, best effort. A failure here is NOT fatal: running yesterday's
# code still produces an archive, and no archive is the worse outcome.
try {
  Push-Location $RepoDir
  git fetch origin main --quiet 2>&1 | Out-Null
  $isAncestor = $false
  git merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -eq 0) { $isAncestor = $true }
  if ($isAncestor) {
    git merge --ff-only origin/main --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Log "fast-forwarded to origin/main" }
    else { Write-Log "WARN: ff-merge declined (dirty tree?) - running existing checkout" }
  } else {
    Write-Log "WARN: HEAD is not an ancestor of origin/main - NOT merging, running as-is"
  }
} catch {
  Write-Log "WARN: self-update skipped - $($_.Exception.Message)"
} finally { Pop-Location }

$script = Join-Path $RepoDir "scripts\export-brain-archive.ts"
if (-not (Test-Path $script)) {
  Write-Log "FATAL: $script not found. This checkout predates the archive script; sync it to origin/main."
  exit 1
}

try {
  Push-Location $RepoDir
  $out = & pnpm exec tsx scripts/export-brain-archive.ts --env $EnvFile 2>&1
  $code = $LASTEXITCODE
  foreach ($l in $out) { if ("$l".Trim()) { Write-Log "  $l" } }
  if ($code -ne 0) { Write-Log "FATAL: export exited $code"; exit $code }
  Write-Log "=== run ok ==="
} finally { Pop-Location }
