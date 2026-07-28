<#
.SYNOPSIS
    Safely tears down a worktree created by scripts/worktree-setup.ps1.

.DESCRIPTION
    worktree-setup.ps1 does NOT copy node_modules into a new worktree. It
    creates NTFS directory junctions (mklink /j) that point at the PRIMARY
    checkout's node_modules -- one at the repo root plus one per apps/* and
    packages/* that has them. A current worktree carries 13 of these, and
    every one of them targets shared state used by the primary checkout AND
    every other worktree.

    That makes the obvious cleanup step dangerous. Running a recursive delete
    over the worktree -- `git worktree remove`, `Remove-Item -Recurse`, or
    `rm -rf` -- traverses a directory tree seeded with links pointing OUT of
    it. Whether any given tool follows an NTFS reparse point or unlinks it is
    a per-tool detail; this script does not rely on knowing. It removes the
    links FIRST, proves the targets survived, and only then deletes anything.

    Order of operations:
      1. Refuse to run from inside the worktree being removed.
      2. Enumerate reparse points under the worktree.
      3. Record each link target and its entry count.
      4. Unlink via [System.IO.Directory]::Delete($path, $false). This removes
         a reparse point but THROWS on a non-empty real directory, so a
         mis-detected junction fails loudly instead of destroying data.
      5. Verify every target still exists and has not LOST entries.
         Abort here if any did -- nothing has been deleted yet.
      6. git worktree remove.
      7. git branch -d, falling back to -D only when the branch content is
         provably identical to the compare branch (squash-merge).

.PARAMETER targetDir
    Path to the worktree to tear down.

.PARAMETER branchName
    Branch to delete after removal. Inferred from the worktree registration
    when omitted. Ignored when -KeepBranch is set.

.PARAMETER compareBranch
    Branch the squash-merge check compares against. Default origin/main.

.PARAMETER KeepBranch
    Remove the worktree but leave the branch alone.

.PARAMETER Force
    Pass --force to `git worktree remove`. Needed when the worktree holds
    untracked or modified files. Only reaches the worktree -- the junction
    unlink and target verification above still run first and still abort.

.EXAMPLE
    powershell scripts/worktree-teardown.ps1 -targetDir .claude/worktrees/my-task

.EXAMPLE
    powershell scripts/worktree-teardown.ps1 -targetDir .worktrees/my-task -Force
#>
param (
    [Parameter(Mandatory=$true)]
    [string]$targetDir,

    [string]$branchName,

    [string]$compareBranch = "origin/main",

    [switch]$KeepBranch,

    [switch]$Force
)

# Deliberately NOT "Stop". This script drives git and must read $LASTEXITCODE
# from commands that are EXPECTED to fail (`git branch -d` refuses a
# squash-merged branch by design). Two ways "Stop" breaks that:
#   - native stderr piped through 2>&1 becomes a terminating NativeCommandError,
#     so even git's harmless "warning: deleting branch ..." aborts the run;
#   - PowerShell 7.4+ makes any non-zero native exit throw as well.
# Every failure path below is checked explicitly instead.
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

function Get-EntryCount {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return -1 }
    if (-not (Test-Path -LiteralPath $Path)) { return -1 }
    return @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue).Count
}

function Get-LinkTarget {
    param($Item)
    # PS 5.1 exposes Target as string[]; PS 7 as string.
    $t = $Item.Target
    if ($null -eq $t) { return $null }
    if ($t -is [array]) {
        if ($t.Count -eq 0) { return $null }
        return [string]$t[0]
    }
    return [string]$t
}

$targetAbsPath = [System.IO.Path]::GetFullPath($targetDir)
$currentAbsPath = [System.IO.Path]::GetFullPath($PWD)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Tearing down worktree" -ForegroundColor Cyan
Write-Host "Target Directory: $targetAbsPath" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------- guards ---

if (-not (Test-Path -LiteralPath $targetAbsPath)) {
    Write-Host "[i] Directory does not exist: $targetAbsPath" -ForegroundColor Gray
    Write-Host "[i] Running 'git worktree prune' to clear any stale registration." -ForegroundColor Gray
    git worktree prune
    exit 0
}

# Removing the worktree you are standing in leaves git and the shell in an
# inconsistent state -- and the open handle is itself what blocks the delete.
$normalizedTarget = $targetAbsPath.TrimEnd('\', '/')
$normalizedCurrent = $currentAbsPath.TrimEnd('\', '/')
if (($normalizedCurrent -eq $normalizedTarget) -or ($normalizedCurrent.StartsWith($normalizedTarget + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase))) {
    Write-Host "[X] Refusing to run: the current directory is inside the worktree being removed." -ForegroundColor Red
    Write-Host "    cd to the primary checkout first." -ForegroundColor Red
    exit 1
}

# ------------------------------------------------- 1. enumerate the links ---

Write-Host "`nScanning for reparse points (junctions / symlinks)..." -ForegroundColor Yellow
$links = @(Get-ChildItem -LiteralPath $targetAbsPath -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType })

if ($links.Count -eq 0) {
    Write-Host "[i] No links found. This worktree has real directories (setup skips" -ForegroundColor Gray
    Write-Host "    linking when pnpm-lock.yaml differs), or was already torn down." -ForegroundColor Gray
} else {
    Write-Host "[i] Found $($links.Count) link(s)." -ForegroundColor Gray
}

# ----------------------------------------- 2. record targets BEFORE unlink ---

$baseline = @{}
foreach ($link in $links) {
    $linkTarget = Get-LinkTarget -Item $link
    if ([string]::IsNullOrWhiteSpace($linkTarget)) {
        Write-Host "[X] Could not resolve the target of $($link.FullName)." -ForegroundColor Red
        Write-Host "    Refusing to continue -- an unresolved link cannot be verified." -ForegroundColor Red
        exit 1
    }
    if (-not $baseline.ContainsKey($linkTarget)) {
        $baseline[$linkTarget] = Get-EntryCount -Path $linkTarget
    }
}

foreach ($key in $baseline.Keys) {
    $count = $baseline[$key]
    Write-Host ("  BEFORE {0,-7} {1}" -f $count, $key) -ForegroundColor Gray
}

# ------------------------------------------------------------ 3. unlink ---

$unlinkFailures = 0
foreach ($link in $links) {
    $linkPath = $link.FullName
    try {
        # Non-recursive by design: removes a reparse point, but throws on a
        # non-empty REAL directory rather than deleting its contents.
        [System.IO.Directory]::Delete($linkPath, $false)
        Write-Host "  Unlinked $linkPath" -ForegroundColor Gray
    } catch {
        $unlinkFailures++
        $msg = $_.Exception.Message
        Write-Host "  [X] Failed to unlink ${linkPath}: $msg" -ForegroundColor Red
    }
}

$remaining = @(Get-ChildItem -LiteralPath $targetAbsPath -Recurse -Force -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType }).Count

# --------------------------------------- 4. verify targets survived intact ---

Write-Host "`nVerifying link targets..." -ForegroundColor Yellow
$targetsDamaged = 0
foreach ($key in $baseline.Keys) {
    $before = $baseline[$key]
    $after = Get-EntryCount -Path $key
    # Fail closed on LOSS. A concurrent `pnpm install` in another session can
    # legitimately raise the count, so only a decrease is treated as damage.
    if (($after -lt $before) -or ($after -le 0)) {
        $targetsDamaged++
        Write-Host ("  [X] {0,-7} -> {1,-7} {2}  DAMAGED" -f $before, $after, $key) -ForegroundColor Red
    } else {
        Write-Host ("  [OK] {0,-7} -> {1,-7} {2}" -f $before, $after, $key) -ForegroundColor Green
    }
}

if ($targetsDamaged -gt 0) {
    Write-Host "`n[X] ABORTING. $targetsDamaged link target(s) lost entries." -ForegroundColor Red
    Write-Host "    Shared node_modules may be damaged. Nothing has been deleted." -ForegroundColor Red
    Write-Host "    Recover with: pnpm install (from the primary checkout)." -ForegroundColor Red
    exit 1
}

if (($unlinkFailures -gt 0) -or ($remaining -gt 0)) {
    Write-Host "`n[X] ABORTING. $unlinkFailures unlink failure(s), $remaining link(s) still present." -ForegroundColor Red
    Write-Host "    A recursive delete now could reach shared state. Nothing has been deleted." -ForegroundColor Red
    exit 1
}

# ------------------------------------------------ 5. resolve branch, remove ---

if ((-not $KeepBranch) -and [string]::IsNullOrWhiteSpace($branchName)) {
    $porcelain = @(git worktree list --porcelain)
    $inBlock = $false
    foreach ($line in $porcelain) {
        if ($line -like "worktree *") {
            $wtPath = $line.Substring(9)
            $wtFull = [System.IO.Path]::GetFullPath($wtPath).TrimEnd('\', '/')
            $inBlock = ($wtFull -eq $normalizedTarget)
        } elseif ($inBlock -and ($line -like "branch refs/heads/*")) {
            $branchName = $line.Substring(18)
            Write-Host "`n[i] Inferred branch: $branchName" -ForegroundColor Gray
            break
        }
    }
}

Write-Host "`nRemoving worktree..." -ForegroundColor Yellow
if ($Force) {
    git worktree remove --force $targetAbsPath
} else {
    git worktree remove $targetAbsPath
}
$removeExit = $LASTEXITCODE

# git can DEREGISTER the worktree and still fail to delete the directory when
# a process holds a handle on it. Report the two outcomes separately -- a
# lingering empty directory is harmless, a failed deregistration is not.
$stillOnDisk = Test-Path -LiteralPath $targetAbsPath
$stillRegistered = $false
foreach ($line in @(git worktree list --porcelain)) {
    if ($line -like "worktree *") {
        $wtFull = [System.IO.Path]::GetFullPath($line.Substring(9)).TrimEnd('\', '/')
        if ($wtFull -eq $normalizedTarget) { $stillRegistered = $true }
    }
}

if ($stillRegistered) {
    Write-Host "[X] Worktree is STILL REGISTERED with git (exit $removeExit)." -ForegroundColor Red
    if (-not $Force) {
        Write-Host "    Untracked or modified files block removal. Re-run with -Force" -ForegroundColor Yellow
        Write-Host "    once you have confirmed nothing in there is worth keeping." -ForegroundColor Yellow
    }
    exit 1
}

Write-Host "[OK] Worktree deregistered from git." -ForegroundColor Green

if ($stillOnDisk) {
    $leftover = @(Get-ChildItem -LiteralPath $targetAbsPath -Recurse -Force -ErrorAction SilentlyContinue).Count
    Write-Host "[*] Directory still on disk with $leftover item(s) remaining:" -ForegroundColor Yellow
    Write-Host "    $targetAbsPath" -ForegroundColor Yellow
    Write-Host "    A process is holding a handle on it (an editor, a shell cd'd" -ForegroundColor Yellow
    Write-Host "    into it, or a dev server). The links are already gone, so this" -ForegroundColor Yellow
    Write-Host "    is inert -- delete it later, or it clears on restart." -ForegroundColor Yellow
} else {
    Write-Host "[OK] Directory removed." -ForegroundColor Green
}

# ------------------------------------------------------- 6. delete branch ---

if ($KeepBranch) {
    Write-Host "`n[i] -KeepBranch set; leaving the branch alone." -ForegroundColor Gray
} elseif ([string]::IsNullOrWhiteSpace($branchName)) {
    Write-Host "`n[*] No branch resolved; skipping branch deletion." -ForegroundColor Yellow
} else {
    Write-Host "`nDeleting branch $branchName..." -ForegroundColor Yellow
    # No 2>&1 redirect: git's advisory notes go to stderr, and piping them
    # into PowerShell would turn a successful delete into a script failure.
    git branch -d $branchName
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] Branch deleted." -ForegroundColor Green
    } else {
        # -d refuses squash-merged branches: the commit is not an ancestor of
        # main even though its CONTENT is already there. An empty diff is the
        # evidence that -D is safe. An unmerged branch has a non-empty diff
        # and is left alone.
        Write-Host "[i] 'git branch -d' refused. Checking for a squash-merge..." -ForegroundColor Gray
        $contentDiff = @(git diff --name-only $compareBranch $branchName)
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[*] Could not diff against $compareBranch. Branch left in place." -ForegroundColor Yellow
        } elseif ($contentDiff.Count -eq 0) {
            Write-Host "[i] Content is identical to $compareBranch (squash-merged)." -ForegroundColor Gray
            git branch -D $branchName
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[OK] Branch deleted." -ForegroundColor Green
            } else {
                Write-Host "[X] Branch deletion failed." -ForegroundColor Red
            }
        } else {
            Write-Host "[*] Branch differs from ${compareBranch} in $($contentDiff.Count) file(s)." -ForegroundColor Yellow
            Write-Host "    It holds unmerged work. Left in place; delete manually if intended." -ForegroundColor Yellow
        }
    }
}

Write-Host "`nWorktree Teardown Complete!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
exit 0
