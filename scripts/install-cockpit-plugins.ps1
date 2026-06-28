# install-cockpit-plugins.ps1 - Setup Obsidian cockpit configuration
param (
    [string]$VaultPath = "C:\Users\nourd\OneDrive\Documents\Obsidian Vault",
    [switch]$SkipDownload,
    [switch]$Force,
    [switch]$DryRun,
    [switch]$RestoreLatest
)

$ErrorActionPreference = "Stop"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Statenour -> Obsidian Cockpit Installer" -ForegroundColor Cyan
Write-Host "Vault Path: $VaultPath" -ForegroundColor Cyan
if ($DryRun) { Write-Host "[DRY RUN ENABLED]" -ForegroundColor Yellow }
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Verify Vault Path
if (-not (Test-Path -Path $VaultPath)) {
    Write-Error "Obsidian Vault path does not exist: $VaultPath"
    exit 1
}

# 1.5 Handle Restore Path (Phase 2.5)
if ($RestoreLatest) {
    Write-Host "Rollback requested: restoring latest configuration backup..." -ForegroundColor Yellow
    $backupRoot = Join-Path -Path $VaultPath -ChildPath ".statenour-backups"
    if (-not (Test-Path -Path $backupRoot)) {
        Write-Error "No backups folder found at: $backupRoot"
        exit 1
    }
    
    # Find the latest backup directory by LastWriteTime
    $latestBackup = Get-ChildItem -Path $backupRoot -Directory | 
        Sort-Object LastWriteTime -Descending | 
        Select-Object -First 1
        
    if ($null -eq $latestBackup) {
        Write-Error "No backup directories found in: $backupRoot"
        exit 1
    }
    
    Write-Host "Restoring from backup folder: $($latestBackup.Name)" -ForegroundColor Yellow
    
    # Find all files in the backup directory
    $backupFiles = Get-ChildItem -Path $latestBackup.FullName -Recurse -File
    
    foreach ($file in $backupFiles) {
        # Calculate relative path from backup directory
        $relPath = $file.FullName.Substring($latestBackup.FullName.Length + 1)
        $destPath = Join-Path -Path $VaultPath -ChildPath $relPath
        $destFolder = Split-Path -Path $destPath
        
        if (-not $DryRun) {
            if (-not (Test-Path -Path $destFolder)) {
                New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
            }
            Copy-Item -Path $file.FullName -Destination $destPath -Force
        }
        Write-Host "  [RESTORED] $relPath" -ForegroundColor Green
    }
    
    Write-Host "Restore complete." -ForegroundColor Green
    exit 0
}

# 2. Setup Backups (Phase 2)
$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = Join-Path -Path $VaultPath -ChildPath ".statenour-backups\$timestamp"

# Helper function to back up a file if it exists
function Backup-File {
    param (
        [string]$filePath
    )
    if (Test-Path -Path $filePath -PathType Leaf) {
        $relativePath = $filePath.Substring($VaultPath.Length + 1)
        $destPath = Join-Path -Path $backupDir -ChildPath $relativePath
        $destFolder = Split-Path -Path $destPath
        
        if (-not $DryRun) {
            if (-not (Test-Path -Path $destFolder)) {
                New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
            }
            Copy-Item -Path $filePath -Destination $destPath -Force
        }
        Write-Host "  [BACKUP] $relativePath -> .statenour-backups/$timestamp/$relativePath" -ForegroundColor Gray
    }
}

Write-Host "Running configuration backup..." -ForegroundColor Yellow
$filesToBackup = @(
    (Join-Path -Path $VaultPath -ChildPath ".obsidian\community-plugins.json"),
    (Join-Path -Path $VaultPath -ChildPath ".obsidian\app.json"),
    (Join-Path -Path $VaultPath -ChildPath ".obsidian\hotkeys.json"),
    (Join-Path -Path $VaultPath -ChildPath ".obsidian\workspace.json"),
    (Join-Path -Path $VaultPath -ChildPath "HQ.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Note Template.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Cockpit Note Template.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Mission Template.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Decision Template.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Rule Template.md"),
    (Join-Path -Path $VaultPath -ChildPath "Statenour\Templates\Daily Capture Template.md")
)

try {
    foreach ($file in $filesToBackup) {
        Backup-File -filePath $file
    }
    Write-Host "Backup completed successfully." -ForegroundColor Green
} catch {
    Write-Error "Backup failed! Aborting installation."
    exit 1
}

# 3. Create Plugin Directory (Phase 3)
$pluginsDir = Join-Path -Path $VaultPath -ChildPath ".obsidian\plugins"
if (-not $DryRun) {
    if (-not (Test-Path -Path $pluginsDir)) {
        New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null
    }
}

# Define Plugins metadata
$plugins = @(
    @{ id = "dataview"; repo = "blacksmithgu/obsidian-dataview"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "templater-obsidian"; repo = "SilentVoid13/Templater"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "obsidian-spaced-repetition"; repo = "st3v3nmw/obsidian-spaced-repetition"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "quickadd"; repo = "chhoumann/quickadd"; files = @("main.js", "manifest.json", "styles.css") },
    @{ id = "obsidian-local-rest-api"; repo = "coddingtonbear/obsidian-local-rest-api"; files = @("main.js", "manifest.json", "styles.css") }
)

$failedPlugins = @()

if (-not $SkipDownload) {
    Write-Host "`nDownloading and installing plugins..." -ForegroundColor Yellow
    
    foreach ($plugin in $plugins) {
        $pluginPath = Join-Path -Path $pluginsDir -ChildPath $plugin.id
        
        if ($DryRun) {
            Write-Host "  [DryRun] Would install plugin: $($plugin.id) ($($plugin.repo))" -ForegroundColor Gray
            continue;
        }

        # Check existing version and manifest (Phase 3.5)
        $manifestPath = Join-Path -Path $pluginPath -ChildPath "manifest.json"
        $existingVersion = $null
        if (Test-Path -Path $manifestPath) {
            try {
                $manifestContent = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
                if ($manifestContent.id -ne $plugin.id) {
                    Write-Host "  [WARNING] Plugin ID mismatch in manifest: $($manifestContent.id) vs expected $($plugin.id)" -ForegroundColor Yellow
                }
                $existingVersion = $manifestContent.version
                Write-Host "  * Found existing version: $existingVersion" -ForegroundColor Gray
            } catch {
                Write-Host "  * Failed to read existing manifest." -ForegroundColor Gray
            }
        }

        if (-not (Test-Path -Path $pluginPath)) {
            New-Item -ItemType Directory -Path $pluginPath -Force | Out-Null
        }

        Write-Host "Installing $($plugin.id) ($($plugin.repo))..." -ForegroundColor Yellow
        $downloadedFiles = 0

        # Try to use GitHub API first to identify releases, fallback to direct download URL redirect
        $assets = @()
        $useApi = $false
        $latestVersion = $null
        try {
            $headers = @{ "User-Agent" = "Mozilla/5.0" }
            # If GITHUB_TOKEN is available in env, use it
            if ($env:GITHUB_TOKEN) {
                $headers["Authorization"] = "token $env:GITHUB_TOKEN"
            }
            $apiRes = Invoke-RestMethod -Uri "https://api.github.com/repos/$($plugin.repo)/releases/latest" -Headers $headers -ErrorAction Stop
            $assets = $apiRes.assets
            $latestVersion = ($apiRes.tag_name).Replace("v", "")
            $useApi = $true
            Write-Host "  * Latest version available: $latestVersion" -ForegroundColor Gray
        } catch {
            Write-Host "  [API Fallback] GitHub API unavailable/rate-limited. Downloading assets directly." -ForegroundColor Gray
        }

        # Version safety check
        if ($null -ne $existingVersion -and $null -ne $latestVersion -and (-not $Force)) {
            try {
                $existingClean = ($existingVersion -split "-")[0] -replace '[^0-9\.]', ''
                $latestClean = ($latestVersion -split "-")[0] -replace '[^0-9\.]', ''
                if (($existingClean -split "\.").Count -eq 1) { $existingClean += ".0" }
                if (($latestClean -split "\.").Count -eq 1) { $latestClean += ".0" }
                
                $existingVerObj = [System.Version]$existingClean
                $latestVerObj = [System.Version]$latestClean
                if ($existingVerObj -ge $latestVerObj) {
                    Write-Host "  * Plugin $($plugin.id) is up to date (v$existingVersion >= v$latestVersion). Skipping download." -ForegroundColor Green
                    continue
                }
            } catch {
                Write-Host "  * Version comparison skipped: $_.Exception.Message" -ForegroundColor Gray
            }
        }

        foreach ($file in $plugin.files) {
            $destFile = Join-Path -Path $pluginPath -ChildPath $file
            
            # Check if file exists and we are not forcing download
            if ((Test-Path -Path $destFile) -and (-not $Force)) {
                Write-Host "  * File $file already exists. Skipping download (use -Force to re-download)." -ForegroundColor Gray
                $downloadedFiles++
                continue
            }

            $url = "https://github.com/$($plugin.repo)/releases/latest/download/$file"
            
            # If we successfully parsed release assets from API, verify asset exists
            if ($useApi) {
                $matchedAsset = $assets | Where-Object { $_.name -eq $file }
                if ($null -eq $matchedAsset) {
                    # Styles.css may not exist
                    if ($file -eq "styles.css") { continue }
                    Write-Host "  * File $file not found in latest release assets." -ForegroundColor Gray
                    continue
                }
                $url = $matchedAsset.browser_download_url
            }

            $success = $false
            # Download with 1 retry
            for ($attempt = 1; $attempt -le 2; $attempt++) {
                try {
                    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                    Invoke-WebRequest -Uri $url -OutFile $destFile -UseBasicParsing -ErrorAction Stop
                    $success = $true
                    break
                } catch {
                    Write-Host "    (Attempt $attempt failed: $_.Exception.Message)" -ForegroundColor Red
                    Start-Sleep -Seconds 1
                }
            }

            if ($success) {
                Write-Host "  * Downloaded $file" -ForegroundColor Gray
                $downloadedFiles++
            } else {
                # styles.css is optional, others are required
                if ($file -ne "styles.css") {
                    Write-Host "  [ERROR] Failed to download required file $file" -ForegroundColor Red
                }
            }
        }

        # Check critical files
        $manifestExists = Test-Path -Path (Join-Path -Path $pluginPath -ChildPath "manifest.json")
        $mainExists = Test-Path -Path (Join-Path -Path $pluginPath -ChildPath "main.js")

        if (-not ($manifestExists -and $mainExists)) {
            Write-Host "  [FAIL] Plugin $($plugin.id) is missing required files." -ForegroundColor Red
            $failedPlugins += $plugin.id
        } else {
            # Log version safety info
            if (Test-Path -Path $manifestPath) {
                try {
                    $manifestContent = Get-Content -Path $manifestPath -Raw | ConvertFrom-Json
                    Write-Host "  [OK] Installed $($plugin.id) (v$($manifestContent.version)) successfully." -ForegroundColor Green
                } catch {
                    Write-Host "  [OK] Installed $($plugin.id) successfully." -ForegroundColor Green
                }
            }
        }
    }
}

# 4. Enable Plugins (Phase 3.6)
$communityPluginsFile = Join-Path -Path $VaultPath -ChildPath ".obsidian\community-plugins.json"

if (-not $DryRun) {
    $currentEnabled = @()
    if (Test-Path -Path $communityPluginsFile) {
        try {
            $content = Get-Content -Path $communityPluginsFile -Raw
            $currentEnabled = ConvertFrom-Json -InputObject $content
            if ($currentEnabled -eq $null) { $currentEnabled = @() }
        } catch {
            Write-Host "  [WARNING] Failed to parse community-plugins.json. Resetting list." -ForegroundColor Yellow
            $currentEnabled = @()
        }
    }

    $updatedEnabled = @()
    # Add existing enabled
    foreach ($item in $currentEnabled) {
        if ($item -notin $updatedEnabled) { $updatedEnabled += $item }
    }
    # Add new ones
    foreach ($plugin in $plugins) {
        if ($plugin.id -notin $failedPlugins -and $plugin.id -notin $updatedEnabled) {
            $updatedEnabled += $plugin.id
            Write-Host "Enabled plugin: $($plugin.id)" -ForegroundColor Green
        }
    }

    $jsonOut = ConvertTo-Json -InputObject $updatedEnabled -Compress
    Set-Content -Path $communityPluginsFile -Value $jsonOut
}

# 5. Create Cockpit Folder Structure (Phase 4)
Write-Host "`nCreating vault directory structure..." -ForegroundColor Yellow
$foldersToCreate = @(
    "00_HQ",
    "01_Inbox",
    "10_Statenour",
    "10_Statenour\Missions",
    "10_Statenour\Goals",
    "10_Statenour\Tasks",
    "10_Statenour\Decisions",
    "10_Statenour\Reflections",
    "10_Statenour\Brain",
    "10_Statenour\People",
    "10_Statenour\Business",
    "10_Statenour\AI-System",
    "20_Operator_Rules",
    "20_Operator_Rules\Beliefs",
    "20_Operator_Rules\Standards",
    "20_Operator_Rules\Protocols",
    "20_Operator_Rules\Decision Rules",
    "20_Operator_Rules\Health Rules",
    "20_Operator_Rules\Business Rules",
    "30_Projects",
    "30_Projects\Nicks Tire",
    "30_Projects\Statenour",
    "30_Projects\Personal OS",
    "40_Archive",
    "Statenour\Templates",
    "Statenour\Quarantine"
)

foreach ($folder in $foldersToCreate) {
    $folderPath = Join-Path -Path $VaultPath -ChildPath $folder
    if (-not (Test-Path -Path $folderPath)) {
        if ($DryRun) {
            Write-Host "  [DryRun] Would create directory: $folder" -ForegroundColor Gray
        } else {
            New-Item -ItemType Directory -Path $folderPath -Force | Out-Null
            Write-Host "  Created folder: $folder" -ForegroundColor Gray
        }
    }
}

# 6. Deploy HQ.md Dashboard (Phase 5)
Write-Host "`nDeploying HQ Dashboard..." -ForegroundColor Yellow
$hqFile = Join-Path -Path $VaultPath -ChildPath "HQ.md"
$hqContentRaw = @'
---
title: HQ
type: dashboard
category: planning
status: active
source: obsidian
sync_direction: none
created_at: {DATE}
updated_at: {DATE}
tags: [hq, dashboard, statenour, cockpit]
---

# HQ - Operator Cockpit

## Today

> This dashboard exists to drive execution, not collect notes.

## Active Missions

```dataview
TABLE type, category, status, horizon, priority, review_due
FROM "10_Statenour/Missions" OR #mission
WHERE status = "active"
SORT priority DESC, review_due ASC, file.mtime DESC
LIMIT 15
```

## Active Goals

```dataview
TABLE category, status, horizon, priority, review_due
FROM "10_Statenour/Goals" OR #goal
WHERE status = "active"
SORT horizon ASC, priority DESC
LIMIT 15
```

## Decisions To Review

```dataview
TABLE category, status, horizon, review_due
FROM "10_Statenour/Decisions" OR #decision
WHERE status != "archived"
AND review_due <= date(today) + dur(7 days)
SORT review_due ASC
LIMIT 15
```

## Stale Active Notes

```dataview
TABLE type, category, status, file.mtime
WHERE status = "active"
AND file.mtime < date(today) - dur(14 days)
SORT file.mtime ASC
LIMIT 15
```

## Rules Due For Review

```dataview
TABLE category, status, review_due
FROM "20_Operator_Rules"
WHERE review_due <= date(today)
SORT review_due ASC
LIMIT 10
```

## Inbox

```dataview
TABLE category, status, created_at
FROM "01_Inbox"
WHERE status = "inbox"
SORT file.ctime DESC
LIMIT 20
```

## Statenour Sync Notes

* Run ingest after inbox cleanup.
* Run export during weekly review.
* Notes without valid category should be quarantined or fixed.
'@

$nowStr = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$hqContent = $hqContentRaw.Replace("{DATE}", $nowStr)

# Merge existing content if file exists
if (Test-Path -Path $hqFile) {
    Write-Host "  * Existing HQ.md found. Merging content..." -ForegroundColor Yellow
    $oldContent = Get-Content -Path $hqFile -Raw
    
    # Check if we already merged before to avoid infinite nesting (Phase 5.5)
    if (-not ($oldContent -match "## Previous HQ Content")) {
        # Strip frontmatter from old content if it exists
        $strippedOld = $oldContent
        if ($oldContent.StartsWith("---")) {
            $parts = $oldContent -split "---", 3
            if ($parts.Length -ge 3) {
                $strippedOld = $parts[2].Trim()
            }
        }
        
        $hqContent = $hqContent + "`n`n## Previous HQ Content`n`n" + $strippedOld
    } else {
        Write-Host "  * HQ.md already contains Previous HQ Content. Prepending latest dashboard sections..." -ForegroundColor Gray
        $parts = $oldContent -split "## Previous HQ Content", 2
        if ($parts.Length -ge 2) {
            $previousContent = $parts[1].Trim()
            $hqContent = $hqContent + "`n`n## Previous HQ Content`n`n" + $previousContent
        } else {
            $hqContent = $oldContent
        }
    }
}

if (-not $DryRun) {
    Set-Content -Path $hqFile -Value $hqContent -Encoding Utf8
    Write-Host "  * Deployed HQ.md successfully." -ForegroundColor Green
}

# 7. Create Templates (Phase 6)
Write-Host "`nDeploying Note Templates..." -ForegroundColor Yellow
$templatesPath = Join-Path -Path $VaultPath -ChildPath "Statenour\Templates"

# Template 1
$t1 = @'
---
title: "<% tp.file.title %>"
type: capture
category: planning
status: inbox
horizon: 1-week
priority: 3
confidence: 0.8
review_due: <% tp.date.now("yyyy-MM-dd", 7) %>
created_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
updated_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
source: obsidian
sync_direction: obsidian_to_statenour
statenour_model:
statenour_id:
tags: []
links:
  missions: []
  goals: []
  people: []
  projects: []
---

# <% tp.file.title %>

## Capture

## Why It Matters

## Next Move

## Links
'@

# Template 2
$t2 = @'
---
title: "<% tp.file.title %>"
type: mission
category: business
status: active
horizon: 1-quarter
priority: 4
confidence: 0.9
review_due: <% tp.date.now("yyyy-MM-dd", 7) %>
created_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
updated_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
source: obsidian
sync_direction: bidirectional
statenour_model: Mission
statenour_id:
tags: [mission]
links:
  goals: []
  people: []
  projects: []
---

# <% tp.file.title %>

## Mission Outcome

## Why It Matters

## Current State

## Critical Few

- [ ] 

## Risks

## Next Move
'@

# Template 3
$t3 = @'
---
title: "<% tp.file.title %>"
type: decision
category: decision_log
status: active
horizon: 1-quarter
priority: 4
confidence: 0.85
review_due: <% tp.date.now("yyyy-MM-dd", 14) %>
created_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
updated_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
source: obsidian
sync_direction: bidirectional
statenour_model: DecisionReplay
statenour_id:
tags: [decision]
links:
  missions: []
  goals: []
  people: []
  projects: []
---

# <% tp.file.title %>

## Decision

## Context

## Options Considered

## Why This Won

## Risks Accepted

## Review Trigger

## Outcome
'@

# Template 4
$t4 = @'
---
title: "<% tp.file.title %>"
type: rule
category: discipline
status: active
horizon: lifetime
priority: 5
confidence: 0.95
review_due: <% tp.date.now("yyyy-MM-dd", 30) %>
created_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
updated_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
source: obsidian
sync_direction: obsidian_to_statenour
statenour_model: BrainMemory
statenour_id:
tags: [rule, review]
links:
  missions: []
  goals: []
  people: []
  projects: []
---

# <% tp.file.title %>

## Rule

## Why It Exists

## When I Forget This

## Correct Behavior

## Review Notes
'@

# Template 5
$t5 = @'
---
title: "Capture - <% tp.date.now("yyyy-MM-dd HHmmss") %>"
type: capture
category: reflection
status: inbox
horizon: today
priority: 2
confidence: 0.7
review_due: <% tp.date.now("yyyy-MM-dd", 1) %>
created_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
updated_at: <% tp.date.now("yyyy-MM-dd HH:mm:ss") %>
source: obsidian
sync_direction: obsidian_to_statenour
statenour_model:
statenour_id:
tags: [capture]
links:
  missions: []
  goals: []
  people: []
  projects: []
---

# Capture

## Raw

## Triage

- [ ] Convert to task
- [ ] Convert to mission
- [ ] Convert to rule
- [ ] Archive
'@

$templatesToDeploy = @(
    @{ name = "Cockpit Note Template.md"; content = $t1 },
    @{ name = "Mission Template.md"; content = $t2 },
    @{ name = "Decision Template.md"; content = $t3 },
    @{ name = "Rule Template.md"; content = $t4 },
    @{ name = "Daily Capture Template.md"; content = $t5 }
)

foreach ($template in $templatesToDeploy) {
    $tempFile = Join-Path -Path $templatesPath -ChildPath $template.name
    if ($DryRun) {
        Write-Host "  [DryRun] Would write template: $($template.name)" -ForegroundColor Gray
    } else {
        Set-Content -Path $tempFile -Value $template.content -Encoding Utf8
        Write-Host "  * Deployed template: $($template.name)" -ForegroundColor Gray
    }
}

# 8. Configure Plugin Defaults (Phase 7 & 7.5)
Write-Host "`nConfiguring plugin settings defaults..." -ForegroundColor Yellow

# Dataview Config
$dvConfigPath = Join-Path -Path $pluginsDir -ChildPath "dataview\data.json"
$dvConfig = @{
    enableDataviewJs = $true
    enableInlineDataviewJs = $true
    enableInlineQueries = $true
    enableQueries = $true
}
if (-not $DryRun) {
    $dvJson = ConvertTo-Json -InputObject $dvConfig -Compress
    Set-Content -Path $dvConfigPath -Value $dvJson -Encoding Utf8
    Write-Host "  * Dataview queries enabled." -ForegroundColor Gray
}

# Templater Config
$tplConfigPath = Join-Path -Path $pluginsDir -ChildPath "templater-obsidian\data.json"
$tplConfig = @{
    templates_folder = "Statenour/Templates"
    sys_enable = $true
    user_scripts_folder = ""
}
if (-not $DryRun) {
    $tplJson = ConvertTo-Json -InputObject $tplConfig -Compress
    Set-Content -Path $tplConfigPath -Value $tplJson -Encoding Utf8
    Write-Host "  * Templater templates folder set to Statenour/Templates." -ForegroundColor Gray
}

# Spaced Repetition Rules Readme (Phase 7.4)
$rulesReadme = Join-Path -Path $VaultPath -ChildPath "20_Operator_Rules\README.md"
$rulesReadmeContent = @'
# 20_Operator_Rules

This directory contains core beliefs, rules, standards, and protocols to safeguard focus and mitigate cognitive drift.

## Spaced Repetition Instructions
1. Enable the **Spaced Repetition** community plugin.
2. Open Spaced Repetition Settings.
3. Under **Notes / Rules**, verify that the queue includes whole-note reviews.
4. Active rules will show up in your daily queue. 
5. Review each note:
   - Mark **Easy / Still True** to advance it in the memory queue.
   - Mark **Hard / Review / Refactor** to flag the rule for active updates or deletion.
'@

if (-not $DryRun) {
    Set-Content -Path $rulesReadme -Value $rulesReadmeContent -Encoding Utf8
}

# Report and Exit (Phase 3.8)
Write-Host "`n==================================================" -ForegroundColor Green
if ($failedPlugins.Count -gt 0) {
    Write-Host "Installer finished with WARNINGS." -ForegroundColor Yellow
    $failedPluginsStr = $failedPlugins -join ", "
    Write-Host "Failed to install the following plugins: $failedPluginsStr" -ForegroundColor Red
} else {
    Write-Host "Installer completed successfully!" -ForegroundColor Green
}
Write-Host "==================================================" -ForegroundColor Green

if ($failedPlugins.Count -gt 0) {
    exit 1
} else {
    exit 0
}
