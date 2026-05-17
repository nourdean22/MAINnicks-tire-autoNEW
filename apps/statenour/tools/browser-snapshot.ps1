# NOUR OS Browser Snapshot - Capture Chrome session state
# Captures open windows, active tabs, and browser metadata

param(
    [string]$Command = "",
    [string]$SessionName = ""
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$SessionsDir = Join-Path $RootDir "workspace" "sessions"
$LogsDir = Join-Path $RootDir "logs"

# Ensure directories exist
New-Item -ItemType Directory -Path $SessionsDir -Force | Out-Null
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

$AuditLog = Join-Path $LogsDir "audit.jsonl"

<#
.FUNCTION LogBrowserEvent
.DESCRIPTION Log browser-related events to audit log
#>
function LogBrowserEvent {
    param(
        [string]$Action,
        [hashtable]$Details
    )
    
    $entry = @{
        type = "browser_event"
        action = $Action
        timestamp = (Get-Date -AsUTC -Format "o")
        details = $Details
    }
    
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -Path $AuditLog -Value $json
}

<#
.FUNCTION GetChromeWindows
.DESCRIPTION Get Chrome window information and metadata
#>
function GetChromeWindows {
    try {
        $chromeProcesses = Get-Process -Name "chrome" -ErrorAction SilentlyContinue
        
        if (-not $chromeProcesses) {
            return @()
        }
        
        if ($chromeProcesses -isnot [array]) {
            $chromeProcesses = @($chromeProcesses)
        }
        
        $windows = @()
        foreach ($process in $chromeProcesses) {
            $windows += @{
                pid = $process.Id
                process_name = $process.ProcessName
                main_window_title = $process.MainWindowTitle
                memory_mb = [math]::Round($process.WorkingSet64 / 1MB)
                start_time = $process.StartTime.ToString("o")
            }
        }
        
        return $windows
    }
    catch {
        Write-Host "Error getting Chrome windows: $_"
        return @()
    }
}

<#
.FUNCTION CaptureSnapshot
.DESCRIPTION Capture current Chrome state and save to JSON
#>
function CaptureSnapshot {
    param(
        [string]$Name = ""
    )
    
    $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
    $sessionName = if ($Name) { "$Name" } else { "session_$timestamp" }
    
    $snapshot = @{
        name = $sessionName
        captured_at = (Get-Date -AsUTC -Format "o")
        browser = @{
            windows = GetChromeWindows
            process_count = (Get-Process -Name "chrome" -ErrorAction SilentlyContinue | Measure-Object).Count
        }
        system = @{
            user = [System.Environment]::UserName
            machine = [System.Environment]::MachineName
        }
    }
    
    $snapshotFile = Join-Path $SessionsDir "$sessionName.json"
    $snapshot | ConvertTo-Json -Depth 5 | Set-Content -Path $snapshotFile
    
    LogBrowserEvent -Action "snapshot_captured" -Details @{
        session_name = $sessionName
        file = $snapshotFile
        chrome_windows = $snapshot.browser.windows.Count
    }
    
    return @{
        status = "success"
        snapshot_name = $sessionName
        file = $snapshotFile
        timestamp = $snapshot.captured_at
    }
}

<#
.FUNCTION ListSnapshots
.DESCRIPTION List all saved browser snapshots
#>
function ListSnapshots {
    if (-not (Test-Path $SessionsDir)) {
        return @()
    }
    
    $snapshots = @()
    Get-ChildItem -Path $SessionsDir -Filter "*.json" | ForEach-Object {
        try {
            $content = Get-Content $_.FullName | ConvertFrom-Json
            $snapshots += @{
                name = $content.name
                captured_at = $content.captured_at
                file = $_.FullName
                chrome_windows = $content.browser.windows.Count
            }
        }
        catch {
            # Skip malformed JSON files
        }
    }
    
    return $snapshots | Sort-Object -Property captured_at -Descending
}

<#
.FUNCTION GetSnapshot
.DESCRIPTION Get details of a specific snapshot
#>
function GetSnapshot {
    param(
        [string]$Name
    )
    
    $snapshotFile = Join-Path $SessionsDir "$Name.json"
    
    if (-not (Test-Path $snapshotFile)) {
        return @{ error = "Snapshot not found: $Name" }
    }
    
    return Get-Content $snapshotFile | ConvertFrom-Json
}

# Main command routing
switch ($Command.ToLower()) {
    "capture" {
        $result = CaptureSnapshot -Name $SessionName
        $result | ConvertTo-Json | Write-Host
    }
    
    "list" {
        $snapshots = ListSnapshots
        @{ snapshots = $snapshots; count = $snapshots.Count } | ConvertTo-Json | Write-Host
    }
    
    "get" {
        if (-not $SessionName) {
            Write-Host '{"error": "Usage: browser-snapshot.ps1 get <session-name>"}'
            exit 1
        }
        $snapshot = GetSnapshot -Name $SessionName
        $snapshot | ConvertTo-Json | Write-Host
    }
    
    default {
        Write-Host "NOUR OS Browser Snapshot"
        Write-Host ""
        Write-Host "Captures Chrome session state for workspace restoration"
        Write-Host ""
        Write-Host "Usage: browser-snapshot.ps1 <command> [args]"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  capture [name]  Capture current Chrome state (optional name)"
        Write-Host "  list            List all saved snapshots"
        Write-Host "  get <name>      Get details of a specific snapshot"
    }
}
