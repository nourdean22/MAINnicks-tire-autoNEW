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
  merging. A DIRTY tree makes the fast-forward decline — that is a WARN, not a
  failure: the run proceeds on the existing checkout, and the WARN names the
  files that jammed it so the morning log says exactly what to clean.

  THE 2026-08-29 SILENT FAILURE THIS SHAPE PREVENTS. The export SUCCEEDED that
  night (files written 03:00:08-09) but the task still reported LastTaskResult=1
  with a log that stopped at 03:00:02. Cause: `$ErrorActionPreference = "Stop"`
  plus a `2>&1` redirect turns the FIRST stderr line of a native command into a
  terminating NativeCommandError in Windows PowerShell 5.1 — the wrapper died
  between the export finishing and its output being logged, so three failed
  nights looked like clean no-ops. The fix below is not "remove Stop": it scopes
  it. The native invocation runs under EAP=Continue (stderr lines become records
  in $out, nothing terminates), the real verdict is $LASTEXITCODE, and an explicit
  catch writes the FATAL line the old try/finally-with-no-catch could never reach.
  A failure now costs a log line and a nonzero exit code — never silence.

  Every run appends to archive-run.log next to the archive, so a silent failure
  is still a visible one. Belt-and-braces: before the export touches anything,
  the current brain-orphans.ndjson — the only copy of 7,486 orphaned embedding
  texts — is copied to snapshots/auto-<date>/, so even a stale checkout running
  the old overwrite-in-place exporter cannot destroy the previous night's orphans.
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

# ── pre-run orphan snapshot (2026-08-29) ───────────────────────────────
# brain-orphans.ndjson is the ONLY copy of the orphaned texts. The exporter
# now writes dated dirs, but if the ff-merge was declined this checkout may
# still run the OLD overwrite-in-place exporter — so the wrapper itself
# preserves last night's orphans before anything can overwrite them.
# Retention keeps 30 days of auto-* dirs; snapshots/ entries that are not
# auto-* (operator snapshots like 2026-08-29-pre-fix) are NEVER touched.
try {
  $latestOrphans = Join-Path $logDir "brain-orphans.ndjson"
  if (Test-Path $latestOrphans) {
    $autoName = "auto-{0}" -f (Get-Date -Format "yyyy-MM-dd")
    $autoDir = Join-Path (Join-Path $logDir "snapshots") $autoName
    New-Item -ItemType Directory -Force -Path $autoDir | Out-Null
    Copy-Item $latestOrphans (Join-Path $autoDir "brain-orphans.ndjson") -Force
    Write-Log "pre-run orphan snapshot -> snapshots\$autoName"
    $autoCutoff = (Get-Date).AddDays(-30).ToString("yyyy-MM-dd")
    Get-ChildItem (Join-Path $logDir "snapshots") -Directory -Filter "auto-*" |
      Where-Object { $_.Name -match "^auto-(\d{4}-\d{2}-\d{2})$" -and $Matches[1] -lt $autoCutoff } |
      ForEach-Object { Remove-Item $_.FullName -Recurse -Force }
  }
} catch {
  # A failed belt-and-braces copy must not stop the run — the export below
  # still produces a fresh archive. Loudly, though.
  Write-Log "WARN: pre-run orphan snapshot failed - $($_.Exception.Message)"
}

# Self-update, best effort. A failure here is NOT fatal: running yesterday's
# code still produces an archive, and no archive is the worse outcome. The
# whole block runs under EAP=Continue: native git commands speak on stderr,
# and under EAP=Stop a stderr line is the 08-29 trap all over again — it
# would terminate the wrapper inside the very catch meant to report it.
try {
  Push-Location $RepoDir
  $ErrorActionPreference = "Continue"
  git fetch origin main --quiet 2>&1 | Out-Null
  $isAncestor = $false
  git merge-base --is-ancestor HEAD origin/main 2>$null
  if ($LASTEXITCODE -eq 0) { $isAncestor = $true }
  if ($isAncestor) {
    git merge --ff-only origin/main --quiet 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { Write-Log "fast-forwarded to origin/main" }
    else {
      $dirty = @(git status --porcelain 2>$null | Select-Object -First 3) -join "; "
      Write-Log "WARN: ff-merge declined - running existing checkout$(if ($dirty) { ". Dirty: $dirty" })"
    }
  } else {
    Write-Log "WARN: HEAD is not an ancestor of origin/main - NOT merging, running as-is"
  }
} catch {
  $dirty = @(git status --porcelain 2>$null | Select-Object -First 3) -join "; "
  Write-Log "WARN: self-update skipped - $($_.Exception.Message)$(if ($dirty) { " Dirty: $dirty" })"
} finally {
  $ErrorActionPreference = "Stop"
  Pop-Location
}

$script = Join-Path $RepoDir "scripts\export-brain-archive.ts"
if (-not (Test-Path $script)) {
  Write-Log "FATAL: $script not found. This checkout predates the archive script; sync it to origin/main."
  exit 1
}

try {
  Push-Location $RepoDir
  # EAP=Continue for the native call ONLY: under EAP=Stop a stderr line from
  # pnpm/tsx terminates the wrapper before any log line runs (the 08-29 trap).
  # The export's own stdout+stderr land in $out as records; $LASTEXITCODE is
  # the verdict. EAP goes back to Stop immediately after.
  $ErrorActionPreference = "Continue"
  $out = & pnpm exec tsx scripts/export-brain-archive.ts --env $EnvFile 2>&1
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  foreach ($l in $out) { if ("$l".Trim()) { Write-Log "  $l" } }
  if ($code -ne 0) { Write-Log "FATAL: export exited $code"; exit $code }
  Write-Log "=== run ok ==="
  exit 0
} catch {
  if ($out) { foreach ($l in $out) { if ("$l".Trim()) { Write-Log "  $l" } } }
  Write-Log "FATAL: export threw - $($_.Exception.Message)"
  exit 1
} finally { Pop-Location }