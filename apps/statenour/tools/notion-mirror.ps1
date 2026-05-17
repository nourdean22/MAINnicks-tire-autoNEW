# NOUR OS Notion Mirror - Local read-only mirror of Notion data
# Syncs key data locally (inbox, tasks, notes), provides offline fallback

param(
    [string]$Command = "",
    [string]$Arg1 = ""
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

# Ensure directories
if (-not (Test-Path $MirrorDir)) {
    New-Item -ItemType Directory -Path $MirrorDir -Force | Out-Null
}

<#
.FUNCTION LogMirrorEvent
.DESCRIPTION Log mirror operations to audit trail
#>
function LogMirrorEvent {
    param(
        [string]$Action,
        [hashtable]$Details
    )
    
    if (Test-Path $LogsDir) {
        $timestamp = [DateTime]::UtcNow.ToString("o")
        $entry = @{
            type = "mirror_event"
            action = $Action
            timestamp = $timestamp
            details = $Details
        }
        $json = $entry | ConvertTo-Json -Compress
        Add-Content -Path $AuditLog -Value $json
    }
}

<#
.FUNCTION InitializeMirror
.DESCRIPTION Create initial mirror structure with empty collections
#>
function InitializeMirror {
    $inboxTemplate = @()
    $tasksTemplate = @()
    $notesTemplate = @()
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $metaTemplate = @{
        initialized = $true
        initialized_at = $timestamp
        offline_mode = $false
        last_sync = $null
    }

    "[]" | Set-Content -Path $InboxMirror
    "[]" | Set-Content -Path $TasksMirror
    "[]" | Set-Content -Path $NotesMirror
    $metaTemplate | ConvertTo-Json | Set-Content -Path $MetaMirror
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    LogMirrorEvent "mirror_init" @{
        status = "success"
        mirrors = @("inbox", "tasks", "notes")
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        mirrors = @("inbox", "tasks", "notes")
        message = "Mirror structure created"
    })
}

<#
.FUNCTION AddInboxItem
.DESCRIPTION Add item to inbox mirror
#>
function AddInboxItem {
    param([string]$Title, [string]$Content = "")
    
    if (-not (Test-Path $InboxMirror)) {
        @() | ConvertTo-Json | Set-Content -Path $InboxMirror
    }
    
    $inbox = Get-Content -Path $InboxMirror -Raw | ConvertFrom-Json
    if ($null -eq $inbox) { $inbox = @() }
    
    $item = @{
        id = [guid]::NewGuid().ToString()
        title = $Title
        content = $Content
        source = "inbox"
        created_at = [DateTime]::UtcNow.ToString("o")
        status = "new"
    }
    
    $inbox += $item
    $inbox | ConvertTo-Json | Set-Content -Path $InboxMirror
    
    LogMirrorEvent "add_inbox" @{
        item_id = $item.id
        title = $Title
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        item_id = $item.id
        message = "Item added to inbox"
    })
}

<#
.FUNCTION AddTask
.DESCRIPTION Add task to tasks mirror
#>
function AddTask {
    param([string]$Title, [string]$Description = "", [string]$Priority = "normal")
    
    if (-not (Test-Path $TasksMirror)) {
        @() | ConvertTo-Json | Set-Content -Path $TasksMirror
    }
    
    $tasks = Get-Content -Path $TasksMirror -Raw | ConvertFrom-Json
    if ($null -eq $tasks) { $tasks = @() }
    
    $task = @{
        id = [guid]::NewGuid().ToString()
        title = $Title
        description = $Description
        status = "todo"
        priority = $Priority
        due_date = $null
        created_at = [DateTime]::UtcNow.ToString("o")
    }
    
    $tasks += $task
    $tasks | ConvertTo-Json | Set-Content -Path $TasksMirror
    
    LogMirrorEvent "add_task" @{
        task_id = $task.id
        title = $Title
        priority = $Priority
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        task_id = $task.id
        message = "Task added"
    })
}

<#
.FUNCTION GetInbox
.DESCRIPTION Retrieve inbox items
#>
function GetInbox {
    if (Test-Path $InboxMirror) {
        $inbox = Get-Content -Path $InboxMirror -Raw | ConvertFrom-Json
        if ($null -eq $inbox) { $inbox = @() }
    } else {
        $inbox = @()
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        count = $inbox.Count
        items = $inbox
    })
}

<#
.FUNCTION GetTasks
.DESCRIPTION Retrieve tasks
#>
function GetTasks {
    if (Test-Path $TasksMirror) {
        $tasks = Get-Content -Path $TasksMirror -Raw | ConvertFrom-Json
        if ($null -eq $tasks) { $tasks = @() }
    } else {
        $tasks = @()
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        count = $tasks.Count
        items = $tasks
    })
}

<#
.FUNCTION SyncStatus
.DESCRIPTION Get current sync status
#>
function SyncStatus {
    if (Test-Path $MetaMirror) {
        $meta = Get-Content -Path $MetaMirror -Raw | ConvertFrom-Json
    } else {
        $meta = @{
            initialized = $false
            offline_mode = $false
            last_sync = $null
        }
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        initialized = $meta.initialized
        offline_mode = $meta.offline_mode
        last_sync = $meta.last_sync
    })
}

<#
.FUNCTION UpdateSyncStatus
.DESCRIPTION Update sync status (called after external sync)
#>
function UpdateSyncStatus {
    if (Test-Path $MetaMirror) {
        $meta = Get-Content -Path $MetaMirror -Raw | ConvertFrom-Json
    } else {
        $meta = @{}
    }
    
    $meta.last_sync = [DateTime]::UtcNow.ToString("o")
    $meta.offline_mode = $false
    
    $meta | ConvertTo-Json | Set-Content -Path $MetaMirror
    
    LogMirrorEvent "sync_completed" @{
        timestamp = $meta.last_sync
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        last_sync = $meta.last_sync
        message = "Sync status updated"
    })
}

# Main command router
switch ($Command.ToLower()) {
    "init" {
        InitializeMirror
    }
    "add-inbox" {
        AddInboxItem -Title $Arg1
    }
    "add-task" {
        AddTask -Title $Arg1
    }
    "inbox" {
        GetInbox
    }
    "tasks" {
        GetTasks
    }
    "status" {
        SyncStatus
    }
    "sync-done" {
        UpdateSyncStatus
    }
    default {
        Write-Host (ConvertTo-Json @{
            error = "Unknown command"
            available = @("init", "add-inbox", "add-task", "inbox", "tasks", "status", "sync-done")
        })
    }
}
