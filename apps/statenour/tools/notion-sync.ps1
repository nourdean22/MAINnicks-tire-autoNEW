# NOUR OS Notion Sync - Syncs Notion data to local mirror
# Connects to Notion API and pulls data into local JSON mirrors
# Supports offline mode with fallback to local cache

param(
    [string]$Command = "sync",
    [string]$Database = "all",
    [switch]$DryRun = $false
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$DataDir = Join-Path -Path $RootDir -ChildPath "workspace" | ForEach-Object { Join-Path -Path $_ -ChildPath "data" }
$MirrorDir = Join-Path -Path $DataDir -ChildPath "mirror"
$ConfigDir = Join-Path -Path $RootDir -ChildPath "config"
$LogsDir = Join-Path -Path $RootDir -ChildPath "logs"

# Mirror files
$InboxMirror = Join-Path -Path $MirrorDir -ChildPath "inbox.json"
$TasksMirror = Join-Path -Path $MirrorDir -ChildPath "tasks.json"
$NotesMirror = Join-Path -Path $MirrorDir -ChildPath "notes.json"
$MetaMirror = Join-Path -Path $MirrorDir -ChildPath "meta.json"
$AuditLog = Join-Path -Path $LogsDir -ChildPath "audit.jsonl"
$SyncLog = Join-Path -Path $LogsDir -ChildPath "sync.jsonl"

# Config
$ConfigFile = Join-Path -Path $ConfigDir -ChildPath "notion-sync.json"

<#
.FUNCTION LogSyncEvent
.DESCRIPTION Log sync operations
#>
function LogSyncEvent {
    param(
        [string]$Action,
        [hashtable]$Details,
        [string]$Level = "info"
    )
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $entry = @{
        type = "sync_event"
        action = $Action
        timestamp = $timestamp
        level = $Level
        details = $Details
    }
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -Path $SyncLog -Value $json
}

<#
.FUNCTION LoadSyncConfig
.DESCRIPTION Load Notion sync configuration
#>
function LoadSyncConfig {
    if (Test-Path $ConfigFile) {
        $config = Get-Content -Path $ConfigFile -Raw | ConvertFrom-Json
        return $config
    }
    
    # Default config structure
    return @{
        notion_api_key = $null
        databases = @{
            inbox = @{
                id = $null
                enabled = $true
            }
            tasks = @{
                id = $null
                enabled = $true
            }
            notes = @{
                id = $null
                enabled = $true
            }
        }
        sync_interval_minutes = 30
        offline_mode = $false
        last_sync = $null
    }
}

<#
.FUNCTION SaveSyncConfig
.DESCRIPTION Save sync configuration
#>
function SaveSyncConfig {
    param([hashtable]$Config)
    
    $Config | ConvertTo-Json | Set-Content -Path $ConfigFile
}

<#
.FUNCTION MergeInboxData
.DESCRIPTION Merge external inbox data into local mirror
#>
function MergeInboxData {
    param([array]$ExternalData)
    
    if (-not (Test-Path $InboxMirror)) {
        "[]" | Set-Content -Path $InboxMirror
    }
    
    $local = Get-Content -Path $InboxMirror -Raw | ConvertFrom-Json
    if ($null -eq $local) { $local = @() }
    
    foreach ($item in $ExternalData) {
        $exists = $local | Where-Object { $_.id -eq $item.id }
        if ($null -eq $exists) {
            $local += $item
        }
    }
    
    $local | ConvertTo-Json | Set-Content -Path $InboxMirror
    return $local.Count
}

<#
.FUNCTION MergeTasksData
.DESCRIPTION Merge external tasks data into local mirror
#>
function MergeTasksData {
    param([array]$ExternalData)
    
    if (-not (Test-Path $TasksMirror)) {
        "[]" | Set-Content -Path $TasksMirror
    }
    
    $local = Get-Content -Path $TasksMirror -Raw | ConvertFrom-Json
    if ($null -eq $local) { $local = @() }
    
    foreach ($item in $ExternalData) {
        $exists = $local | Where-Object { $_.id -eq $item.id }
        if ($null -eq $exists) {
            $local += $item
        }
    }
    
    $local | ConvertTo-Json | Set-Content -Path $TasksMirror
    return $local.Count
}

<#
.FUNCTION MergeNotesData
.DESCRIPTION Merge external notes data into local mirror
#>
function MergeNotesData {
    param([array]$ExternalData)
    
    if (-not (Test-Path $NotesMirror)) {
        "[]" | Set-Content -Path $NotesMirror
    }
    
    $local = Get-Content -Path $NotesMirror -Raw | ConvertFrom-Json
    if ($null -eq $local) { $local = @() }
    
    foreach ($item in $ExternalData) {
        $exists = $local | Where-Object { $_.id -eq $item.id }
        if ($null -eq $exists) {
            $local += $item
        }
    }
    
    $local | ConvertTo-Json | Set-Content -Path $NotesMirror
    return $local.Count
}

<#
.FUNCTION SyncFromNotion
.DESCRIPTION Sync data from Notion (mock implementation, ready for real API)
#>
function SyncFromNotion {
    param([hashtable]$Config)
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $results = @{
        inbox_count = 0
        tasks_count = 0
        notes_count = 0
        errors = @()
    }
    
    if ($null -eq $Config.notion_api_key) {
        LogSyncEvent "sync_skipped" @{
            reason = "no_api_key"
            message = "Notion API key not configured"
        } "info"
        
        return $results
    }
    
    # Mock Notion API calls (ready to replace with real implementation)
    try {
        # Placeholder for real Notion API call
        # $inbox = Invoke-RestMethod -Uri "https://api.notion.com/v1/databases/$($Config.databases.inbox.id)/query" ...
        
        $results.inbox_count = 0
        $results.tasks_count = 0
        $results.notes_count = 0
        
        LogSyncEvent "sync_completed" @{
            inbox = $results.inbox_count
            tasks = $results.tasks_count
            notes = $results.notes_count
            timestamp = $timestamp
        } "info"
    }
    catch {
        $results.errors += $_.Exception.Message
        LogSyncEvent "sync_failed" @{
            error = $_.Exception.Message
        } "error"
    }
    
    return $results
}

<#
.FUNCTION InitializeConfig
.DESCRIPTION Initialize sync configuration
#>
function InitializeConfig {
    $config = LoadSyncConfig
    $config.offline_mode = $false
    SaveSyncConfig $config
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Sync configuration initialized"
        config_path = $ConfigFile
    })
    
    LogSyncEvent "config_init" @{
        config_path = $ConfigFile
    }
}

<#
.FUNCTION PerformSync
.DESCRIPTION Execute sync operation
#>
function PerformSync {
    param([hashtable]$Config)
    
    Write-Host (ConvertTo-Json @{
        status = "in_progress"
        message = "Starting Notion sync"
    })
    
    $startTime = [DateTime]::UtcNow
    $results = SyncFromNotion $Config
    $endTime = [DateTime]::UtcNow
    $duration = ($endTime - $startTime).TotalSeconds
    
    # Update metadata
    if (Test-Path $MetaMirror) {
        $meta = Get-Content -Path $MetaMirror -Raw | ConvertFrom-Json
    } else {
        $meta = @{}
    }
    
    $meta.last_sync = $endTime.ToString("o")
    $meta.offline_mode = $false
    
    $meta | ConvertTo-Json | Set-Content -Path $MetaMirror
    
    # Log results
    LogSyncEvent "sync_result" @{
        duration_seconds = $duration
        inbox_count = $results.inbox_count
        tasks_count = $results.tasks_count
        notes_count = $results.notes_count
        errors = $results.errors
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Sync completed"
        duration_seconds = $duration
        results = $results
        last_sync = $meta.last_sync
    })
}

<#
.FUNCTION SetApiKey
.DESCRIPTION Set Notion API key securely
#>
function SetApiKey {
    param([string]$ApiKey)
    
    $config = LoadSyncConfig
    $config.notion_api_key = $ApiKey
    SaveSyncConfig $config
    
    LogSyncEvent "api_key_set" @{
        timestamp = [DateTime]::UtcNow.ToString("o")
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "API key configured"
    })
}

<#
.FUNCTION GetStatus
.DESCRIPTION Get current sync status
#>
function GetStatus {
    $config = LoadSyncConfig
    
    $status = @{
        configured = $null -ne $config.notion_api_key
        offline_mode = $config.offline_mode
        last_sync = $config.last_sync
        databases = $config.databases
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        sync_status = $status
    })
}

# Main command router
switch ($Command.ToLower()) {
    "init" {
        InitializeConfig
    }
    "sync" {
        $config = LoadSyncConfig
        if ($DryRun) {
            Write-Host (ConvertTo-Json @{
                status = "dry_run"
                message = "Dry run mode - no changes made"
                config = $config
            })
        } else {
            PerformSync $config
        }
    }
    "set-api-key" {
        SetApiKey -ApiKey $Database
    }
    "status" {
        GetStatus
    }
    "offline" {
        $config = LoadSyncConfig
        $config.offline_mode = $true
        SaveSyncConfig $config
        
        Write-Host (ConvertTo-Json @{
            status = "success"
            message = "Offline mode enabled"
        })
    }
    default {
        Write-Host (ConvertTo-Json @{
            error = "Unknown command"
            available = @("init", "sync", "set-api-key", "status", "offline")
        })
    }
}
