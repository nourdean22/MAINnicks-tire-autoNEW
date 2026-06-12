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
    Write-Host "Running: git worktree add $targetAbsPath $branchName" -ForegroundColor Yellow
    git worktree add $targetAbsPath $branchName
} catch {
    Write-Error "Failed to add git worktree: $_"
}

# 2. Copy env files
Write-Host "`nCopying environment files..." -ForegroundColor Yellow
$envFiles = Get-ChildItem -Path $currentAbsPath -Filter ".env*" -Recurse -File | 
    Where-Object { $_.FullName -notmatch "node_modules" -and $_.FullName -notmatch "\.git" -and $_.FullName -notmatch "\.worktrees" }

foreach ($file in $envFiles) {
    # Calculate relative path
    $relativePath = Resolve-Path -Path $file.FullName -Relative
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
    Copy-Item -Path $file.FullName -Destination $destPath -Force
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
}

Write-Host "`nGit Worktree Setup Complete!" -ForegroundColor Green
Write-Host "To start working, navigate to: $targetAbsPath" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
