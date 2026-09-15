<#
.SYNOPSIS
    Selects the env files worktree-setup.ps1 copies into a new worktree.

.DESCRIPTION
    Extracted from worktree-setup.ps1 so the selection RULE is testable
    without creating a worktree, junctioning node_modules, or touching the
    shared checkout. Canary: apps/statenour/tests/repo/worktree-setup-env-filter.test.ts

    Two rules, each from a defect observed on 2026-09-15:

    1. NEVER copy a file git TRACKS. The old glob copied `.env.example`,
       which is CHECKED IN, so a worktree created from origin/main opened with
       the primary checkout's older copy written over the branch's version:
       apps/nickstire/.env.example lost 29 lines (the "Optical finish" block
       added by #2246, 77c4ab9d7). It surfaces as a modified file nobody
       edited, and is committable by accident by anyone who stages the whole
       tree instead of by explicit path.

    2. NEVER recurse into a sibling worktree. The old filter tested
       `-notmatch "\.worktrees"`, which does NOT match `.claude\worktrees\...`
       -- that path segment is `worktrees`, with no leading dot. Setup
       therefore walked every harness worktree on the machine.

    Measured on this repo immediately before the fix: the old filter selected
    39 files, of which 34 came from sibling worktrees and 36 were tracked
    `.env.example` templates -- to deliver the 3 files that are actually local
    secrets. One of those 34 was another session's live `.env`.

    The `.git` exclusion is also now segment-anchored. The old `-notmatch
    "\.git"` matched `.github` as a side effect; a tracked file under
    .github is excluded by rule 1 anyway.

.PARAMETER SourceRoot
    Checkout to scan (normally the primary checkout running the setup).

.OUTPUTS
    System.String -- the absolute path of each file that SHOULD be copied.
#>
param (
    [Parameter(Mandatory = $true)]
    [string]$SourceRoot
)

$rootFull = [System.IO.Path]::GetFullPath($SourceRoot).TrimEnd('\', '/')

# Directories we never walk. Each alternative is anchored to a full path
# segment so that `.github` is not caught by `.git`, and so that BOTH worktree
# conventions are caught: `.worktrees/` and `.claude/worktrees/`.
$excludedPath = '[\\/](?:node_modules|\.git|\.worktrees)[\\/]|[\\/]\.claude[\\/]worktrees[\\/]'

$candidates = Get-ChildItem -Path $rootFull -Filter ".env*" -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -notmatch $excludedPath }

# One `git ls-files` for the whole checkout beats one `--error-unmatch` per
# candidate. Paths come back repo-relative with forward slashes.
$tracked = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($line in (& git -C $rootFull ls-files 2>$null)) {
    if ($line) { [void]$tracked.Add($line) }
}

foreach ($file in $candidates) {
    $relative = $file.FullName.Substring($rootFull.Length).TrimStart('\', '/').Replace('\', '/')
    if ($tracked.Contains($relative)) { continue }
    $file.FullName
}
