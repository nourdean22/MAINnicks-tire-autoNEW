# NOUR OS Workspace Manager - Organizes and restores browser/workspace state
# Manages session restoration, saves workspace context, coordinates with orchestrator

param(
    [string]$Command = "",
    [string]$WorkspaceName = ""
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$WorkspaceDir = Join-Path $RootDir "workspace"
$SessionsDir = Join-Path $WorkspaceDir "sessions"
$ContextFile = Join-Path $WorkspaceDir "context.json"
$LogsDir = Join-Path $RootDir "logs"
$AuditLog = Join-Path $LogsDir "audit.jsonl"

# Ensure directories
New-Item -ItemType Directory -Path $WorkspaceDir -Force | Out-Null
New-Item -ItemType Directory -Path $SessionsDir -Force | Out-Null

<#
.FUNCTION LogWorkspaceEvent
.DESCRIPTION Log workspace state changes
#>
function LogWorkspaceEvent {
    param(
        [string]$Action,
        [hashtable]$Details
    )
    
    $entry = @{
        type = "workspace_event"
        action = $Action
        timestamp = (Get-Date -AsUTC -Format "o")
        details = $Details
    }
    
    $json = $entry | ConvertTo-Json -Compress
    if (Test-Path $LogsDir) {
        Add-Content -Path $AuditLog -Value $json
    }
}

<#
.FUNCTION InitializeWorkspace
.DESCRIPTION Create new workspace context
#>
function InitializeWorkspace {
    param(
        [string]$Name = "default"
    )
    
    $context = @{
        workspace_name = $Name
        initialized_at = (Get-Date -AsUTC -Format "o")
        active_session = $null
        sessions = @()
        browser_profile_path = $null
        restore_browser = $false
        restore_workspace = $false
    }
    
    $context | ConvertTo-Json -Depth 5 | Set-Content -Path $ContextFile
    
    LogWorkspaceEvent -Action "workspace_initialized" -Details @{ name = $Name }
    
    return $context
}

<#
.FUNCTION GetWorkspaceContext
.DESCRIPTION Get current workspace state
#>
function GetWorkspaceContext {
    if (Test-Path $ContextFile) {
        return Get-Content $ContextFile | ConvertFrom-Json
    }
    
    return InitializeWorkspace
}

<#
.FUNCTION SaveWorkspaceState
.DESCRIPTION Save current workspace snapshot
#>
function SaveWorkspaceState {
    param(
        [string]$Name = ""
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $snapshotName = if ($Name) { "$Name" } else { "workspace_$timestamp" }
    
    $context = GetWorkspaceContext
    $context.active_session = $snapshotName
    
    $snapshot = @{
        name = $snapshotName
        saved_at = (Get-Date -AsUTC -Format "o")
        context = $context
        browser_sessions = @()
        file_state = @{
            workspace_root = $WorkspaceDir
            recent_files = @()
        }
    }
    
    $snapshotFile = Join-Path $SessionsDir "$snapshotName.json"
    $snapshot | ConvertTo-Json -Depth 10 | Set-Content -Path $snapshotFile
    
    $context.sessions += $snapshotName
    $context | ConvertTo-Json -Depth 5 | Set-Content -Path $ContextFile
    
    LogWorkspaceEvent -Action "workspace_snapshot_saved" -Details @{
        snapshot = $snapshotName
        file = $snapshotFile
    }
    
    return @{
        status = "success"
        snapshot = $snapshotName
        file = $snapshotFile
    }
}

<#
.FUNCTION RestoreWorkspaceState
.DESCRIPTION Restore workspace from snapshot
#>
function RestoreWorkspaceState {
    param(
        [string]$SnapshotName
    )
    
    $snapshotFile = Join-Path $SessionsDir "$SnapshotName.json"
    
    if (-not (Test-Path $snapshotFile)) {
        return @{ error = "Snapshot not found: $SnapshotName" }
    }
    
    $snapshot = Get-Content $snapshotFile | ConvertFrom-Json
    
    LogWorkspaceEvent -Action "workspace_restore_initiated" -Details @{
        snapshot = $SnapshotName
    }
    
    return @{
        status = "success"
        message = "Workspace restore initiated"
        snapshot = $snapshot
    }
}

<#
.FUNCTION ListWorkspaceSessions
.DESCRIPTION List all saved workspace sessions
#>
function ListWorkspaceSessions {
    $context = GetWorkspaceContext
    
    $sessions = @()
    Get-ChildItem -Path $SessionsDir -Filter "*.json" -ErrorAction SilentlyContinue | ForEach-Object {
        try {
            $snapshot = Get-Content $_.FullName | ConvertFrom-Json
            $sessions += @{
                name = $snapshot.name
                saved_at = $snapshot.saved_at
                file = $_.FullName
            }
        }
        catch {
            # Skip malformed files
        }
    }
    
    return @{
        context = $context
        sessions = ($sessions | Sort-Object -Property saved_at -Descending)
        count = $sessions.Count
    }
}

# Main command routing
switch ($Command.ToLower()) {
    "init" {
        $result = InitializeWorkspace -Name $WorkspaceName
        $result | ConvertTo-Json | Write-Host
    }
    
    "save" {
        $result = SaveWorkspaceState -Name $WorkspaceName
        $result | ConvertTo-Json | Write-Host
    }
    
    "restore" {
        if (-not $WorkspaceName) {
            Write-Host '{"error": "Usage: workspace-manager.ps1 restore <snapshot-name>"}'
            exit 1
        }
        $result = RestoreWorkspaceState -SnapshotName $WorkspaceName
        $result | ConvertTo-Json | Write-Host
    }
    
    "list" {
        $result = ListWorkspaceSessions
        $result | ConvertTo-Json | Write-Host
    }
    
    "status" {
        $context = GetWorkspaceContext
        $context | ConvertTo-Json | Write-Host
    }
    
    default {
        Write-Host "NOUR OS Workspace Manager"
        Write-Host ""
        Write-Host "Manages workspace state, browser sessions, and restoration"
        Write-Host ""
        Write-Host "Usage: workspace-manager.ps1 <command> [name]"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  init [name]     Initialize workspace (default: 'default')"
        Write-Host "  save [name]     Save current workspace state"
        Write-Host "  restore <name>  Restore workspace from snapshot"
        Write-Host "  list            List all saved workspace snapshots"
        Write-Host "  status          Show current workspace context"
    }
}
