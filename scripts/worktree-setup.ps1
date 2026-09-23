param (
    [Parameter(Mandatory=$true)]
    [string]$branchName,

    [Parameter(Mandatory=$true)]
    [string]$targetDir
)

$ErrorActionPreference = "Stop"

# Get absolute path of targetDir
$targetAbsPath = [System.IO.Path]::GetFullPath($targetDir)
$currentAbsPath = [System.IO.Path]::GetFullPath($PWD)

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Creating Git Worktree for branch: $branchName" -ForegroundColor Cyan
Write-Host "Target Directory: $targetAbsPath" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Add Git Worktree
try {
    # Check if branch exists locally or on remote
    $null = git rev-parse --verify --quiet $branchName
    $localExists = ($LASTEXITCODE -eq 0)

    $null = git rev-parse --verify --quiet "origin/$branchName"
    $remoteExists = ($LASTEXITCODE -eq 0)

    if ($localExists -or $remoteExists) {
        Write-Host "Running: git worktree add $targetAbsPath $branchName" -ForegroundColor Yellow
        git worktree add $targetAbsPath $branchName
    } else {
        Write-Host "Branch '$branchName' not found locally or on origin. Creating new branch off origin/main." -ForegroundColor Yellow
        Write-Host "Running: git worktree add -b $branchName $targetAbsPath origin/main" -ForegroundColor Yellow
        git worktree add -b $branchName $targetAbsPath origin/main
    }
} catch {
    Write-Error "Failed to add git worktree: $_"
}

# 1.5. Acquire a Session Authority lease (2026-09-23) now that the worktree
#      exists. agent-start.mjs exits 0 both when it acquires the lease AND on
#      an infrastructure failure (no network, no token) -- a broken lease
#      service must never block worktree creation. It exits nonzero ONLY when
#      another session actively, verifiably holds this branch right now, which
#      is the one case worth stopping for: this worktree's uncommitted work
#      would then risk colliding with theirs.
Write-Host "`nAcquiring Session Authority lease..." -ForegroundColor Yellow
try {
    node (Join-Path $PSScriptRoot "agent-os/agent-start.mjs") --branch $branchName --worktree $targetAbsPath --session-kind bridge --claimed-by "worktree-setup.ps1"
    $leaseExit = $LASTEXITCODE
} catch {
    Write-Host "[*] Could not run the lease check ($_) -- proceeding without one." -ForegroundColor Yellow
    $leaseExit = 0
}
if ($leaseExit -ne 0) {
    Write-Host "[X] ABORTING. '$branchName' appears to be actively leased by another session -- see the message above." -ForegroundColor Red
    Write-Host "    This worktree's uncommitted work could collide with theirs." -ForegroundColor Red
    exit 1
}

# 2. Copy env files
Write-Host "`nCopying environment files..." -ForegroundColor Yellow
# Selection lives in its own script so the rule is testable without building a
# worktree -- it must copy real local secrets (.env / .env.local) and never a
# git-TRACKED template (.env.example) nor anything inside a sibling worktree.
# See scripts/worktree-env-files.ps1 for the two defects this prevents.
$envFiles = & (Join-Path $PSScriptRoot "worktree-env-files.ps1") -SourceRoot $currentAbsPath

foreach ($file in $envFiles) {
    # Calculate relative path
    $relativePath = Resolve-Path -Path $file -Relative
    # Remove leading .\
    if ($relativePath.StartsWith(".\")) {
        $relativePath = $relativePath.Substring(2)
    }
    
    $destPath = Join-Path -Path $targetAbsPath -ChildPath $relativePath
    $destFolder = Split-Path -Path $destPath
    
    if (-not (Test-Path -Path $destFolder)) {
        New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
    }
    
    Write-Host "Copying $relativePath -> $destPath" -ForegroundColor Gray
    Copy-Item -Path $file -Destination $destPath -Force
}

# 3. Parse and check critical keys in destination env files
Write-Host "`nValidating environment variables in new worktree..." -ForegroundColor Yellow
$criticalKeys = @("DATABASE_URL", "META_CAPI_ACCESS_TOKEN", "TIDB_HOST")

$targetEnvFiles = Get-ChildItem -Path $targetAbsPath -Filter ".env" -Recurse -File | 
    Where-Object { $_.FullName -notmatch "node_modules" -and $_.FullName -notmatch "\.git" }

foreach ($envFile in $targetEnvFiles) {
    $relativePath = $envFile.FullName.Substring($targetAbsPath.Length + 1)
    Write-Host "Checking $relativePath..." -ForegroundColor Gray
    $content = Get-Content -Path $envFile.FullName
    
    foreach ($key in $criticalKeys) {
        $match = $content | Where-Object { $_ -match "^$key\s*=" }
        if ($match) {
            $value = ($match -split "=", 2)[1].Trim().Trim('"').Trim("'")
            if ([string]::IsNullOrWhiteSpace($value)) {
                Write-Host "  [WARNING] Key '$key' is present in $relativePath but is EMPTY!" -ForegroundColor Yellow
            } else {
                Write-Host "  [OK] Key '$key' is defined." -ForegroundColor Green
            }
        } else {
            Write-Host "  [WARNING] Key '$key' is MISSING in $relativePath!" -ForegroundColor Yellow
        }
    }
}

# 4. Check pnpm-lock.yaml differences
Write-Host "`nChecking for dependency lockfile differences..." -ForegroundColor Yellow
$lockfileDiff = git diff --name-only HEAD $branchName -- pnpm-lock.yaml

if ([string]::IsNullOrEmpty($lockfileDiff)) {
    Write-Host "No changes detected in pnpm-lock.yaml. Linking existing node_modules to save disk space and time..." -ForegroundColor Green
    
    # Find active node_modules directories in the current worktree
    $activeNodeModules = Get-ChildItem -Path $currentAbsPath -Filter "node_modules" -Recurse -Directory |
        Where-Object { $_.FullName -notmatch "\.worktrees" -and $_.FullName -notmatch "node_modules.*node_modules" }
        
    foreach ($dir in $activeNodeModules) {
        $relPath = $dir.FullName.Substring($currentAbsPath.Length + 1)
        $destJunction = Join-Path -Path $targetAbsPath -ChildPath $relPath
        $destJunctionParent = Split-Path -Path $destJunction
        
        if (-not (Test-Path -Path $destJunctionParent)) {
            New-Item -ItemType Directory -Path $destJunctionParent -Force | Out-Null
        }
        
        if (Test-Path -Path $destJunction) {
            Write-Host "Destination directory $destJunction already exists. Skipping link." -ForegroundColor Gray
        } else {
            Write-Host "Linking $relPath -> $destJunction" -ForegroundColor Gray
            # Create a Directory Junction
            cmd /c mklink /j "$destJunction" "$($dir.FullName)" | Out-Null
        }
    }
} else {
    Write-Host "Differences in pnpm-lock.yaml detected. Bypassing node_modules link." -ForegroundColor Yellow
    Write-Host "Please run 'pnpm install' in '$targetAbsPath' manually to install dependencies." -ForegroundColor Cyan
    # Until that install runs the worktree has NO node_modules, so lefthook is not
    # resolvable and BOTH git hooks silently no-op ("Can't find lefthook in PATH").
    # Observed 2026-09-15: PR #2329 was committed and pushed from such a worktree
    # with neither the pre-commit checks nor the pre-push build ever running.
    Write-Host "  WARNING: until then this worktree has NO node_modules, so lefthook is" -ForegroundColor Red
    Write-Host "  absent and pre-commit/pre-push hooks will NOT run. CI becomes your only" -ForegroundColor Red
    Write-Host "  gate -- run the verify gates in the primary checkout and say so in the PR." -ForegroundColor Red
}

Write-Host "`nGit Worktree Setup Complete!" -ForegroundColor Green
Write-Host "To start working, navigate to: $targetAbsPath" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
