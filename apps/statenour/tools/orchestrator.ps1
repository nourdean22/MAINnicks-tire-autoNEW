# NOUR OS Orchestrator - Core execution engine
# PowerShell-based task runner with logging and state management

param(
    [string]$Command = "",
    [string]$Arg1 = "",
    [string]$Arg2 = ""
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$LogsDir = Join-Path $RootDir "logs"
$ConfigFile = Join-Path $RootDir "config" "orchestrator.yaml"
$StateFile = Join-Path $LogsDir "state.json"

# Ensure logs directory exists
New-Item -ItemType Directory -Path $LogsDir -Force | Out-Null

# Initialize logging files
$AuditLog = Join-Path $LogsDir "audit.jsonl"
$EventsLog = Join-Path $LogsDir "events.jsonl"
$ErrorsLog = Join-Path $LogsDir "errors.jsonl"

<#
.FUNCTION WriteLog
.DESCRIPTION Write structured JSON log entry
#>
function WriteLog {
    param(
        [string]$LogFile,
        [hashtable]$Entry
    )
    
    $Entry["timestamp"] = (Get-Date -AsUTC -Format "o")
    $json = $Entry | ConvertTo-Json -Compress
    Add-Content -Path $LogFile -Value $json
}

<#
.FUNCTION LogAudit
.DESCRIPTION Log an audit event (state changes, actions)
#>
function LogAudit {
    param(
        [string]$Action,
        [string]$Actor = "orchestrator",
        [hashtable]$Details = @{}
    )
    
    $entry = @{
        type = "audit"
        action = $Action
        actor = $Actor
        details = $Details
    }
    WriteLog -LogFile $AuditLog -Entry $entry
}

<#
.FUNCTION LogEvent
.DESCRIPTION Log a system event
#>
function LogEvent {
    param(
        [string]$EventType,
        [string]$Message,
        [hashtable]$Data = @{}
    )
    
    $entry = @{
        type = "event"
        event_type = $EventType
        message = $Message
        data = $Data
    }
    WriteLog -LogFile $EventsLog -Entry $entry
}

<#
.FUNCTION LogError
.DESCRIPTION Log an error
#>
function LogError {
    param(
        [string]$ErrorType,
        [string]$Message,
        [string]$Traceback = $null
    )
    
    $entry = @{
        type = "error"
        error_type = $ErrorType
        message = $Message
        traceback = $Traceback
    }
    WriteLog -LogFile $ErrorsLog -Entry $entry
}

<#
.FUNCTION LogCommand
.DESCRIPTION Log a command execution
#>
function LogCommand {
    param(
        [string]$Cmd,
        [string]$Status,
        [string]$Output = $null,
        [int]$DurationMs = $null
    )
    
    $entry = @{
        type = "command"
        command = $Cmd
        status = $Status
        output = $Output
        duration_ms = $DurationMs
    }
    WriteLog -LogFile $AuditLog -Entry $entry
}

<#
.FUNCTION LoadState
.DESCRIPTION Load or initialize orchestrator state
#>
function LoadState {
    if (Test-Path $StateFile) {
        return Get-Content $StateFile -Raw | ConvertFrom-Json
    }
    
    return @{
        initialized_at = (Get-Date -AsUTC -Format "o")
        tasks_executed = 0
        tasks_failed = 0
        last_execution = $null
    }
}

<#
.FUNCTION SaveState
.DESCRIPTION Save orchestrator state to disk
#>
function SaveState {
    param(
        [hashtable]$State
    )
    
    $State | ConvertTo-Json | Set-Content -Path $StateFile
    LogAudit -Action "state_saved" -Details @{ file = $StateFile }
}

<#
.FUNCTION ExecuteCommand
.DESCRIPTION Execute a shell command with logging
#>
function ExecuteCommand {
    param(
        [string]$Command,
        [string]$Description = $null,
        [switch]$DryRun = $false,
        [int]$Timeout = 3600
    )
    
    $result = @{
        command = $Command
        description = $Description
        dry_run = $DryRun
        status = "pending"
        output = $null
        error = $null
        duration_ms = 0
        executed_at = (Get-Date -AsUTC -Format "o")
    }
    
    LogEvent -EventType "command_queued" -Message "Command: $Command" -Data @{ description = $Description }
    
    if ($DryRun) {
        $result.status = "dry_run"
        LogAudit -Action "command_dry_run" -Details $result
        return $result
    }
    
    try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        $scriptBlock = [scriptblock]::Create($Command)
        $output = & $scriptBlock 2>&1
        $stopwatch.Stop()
        
        $result.status = "success"
        $result.output = $output | Out-String
        $result.duration_ms = [int]$stopwatch.ElapsedMilliseconds
        
        LogCommand -Cmd $Command -Status "success" -Output $result.output -DurationMs $result.duration_ms
        
        $state = LoadState
        $state.tasks_executed += 1
        $state.last_execution = (Get-Date -AsUTC -Format "o")
        SaveState -State $state
    }
    catch {
        $result.status = "error"
        $result.error = $_.Exception.Message
        LogError -ErrorType "execution_error" -Message $_.Exception.Message -Traceback $_.ScriptStackTrace
        
        $state = LoadState
        $state.tasks_failed += 1
        SaveState -State $state
    }
    
    return $result
}

<#
.FUNCTION GetStatus
.DESCRIPTION Get orchestrator status and statistics
#>
function GetStatus {
    $state = LoadState
    
    return @{
        system = @{
            name = "statenour"
            version = "0.1.0"
            environment = "development"
        }
        state = $state
        paths = @{
            root = $RootDir
            logs = $LogsDir
            config = Join-Path $RootDir "config"
        }
        status = "healthy"
    }
}

<#
.FUNCTION GetAuditTrail
.DESCRIPTION Get recent audit entries
#>
function GetAuditTrail {
    param(
        [int]$Limit = 20
    )
    
    if (-not (Test-Path $AuditLog)) {
        return @()
    }
    
    $entries = @()
    Get-Content $AuditLog | ForEach-Object {
        try {
            $entries += $_ | ConvertFrom-Json
        }
        catch {
            # Skip malformed lines
        }
    }
    
    return $entries | Select-Object -Last $Limit
}

# Main command routing
switch ($Command.ToLower()) {
    "status" {
        GetStatus | ConvertTo-Json | Write-Host
    }
    
    "exec" {
        if (-not $Arg1) {
            Write-Host "Usage: orchestrator.ps1 exec <command>"
            exit 1
        }
        $cmd = if ($Arg2) { "$Arg1 $Arg2" } else { $Arg1 }
        $result = ExecuteCommand -Command $cmd
        $result | ConvertTo-Json | Write-Host
    }
    
    "exec-dry" {
        if (-not $Arg1) {
            Write-Host "Usage: orchestrator.ps1 exec-dry <command>"
            exit 1
        }
        $cmd = if ($Arg2) { "$Arg1 $Arg2" } else { $Arg1 }
        $result = ExecuteCommand -Command $cmd -DryRun
        $result | ConvertTo-Json | Write-Host
    }
    
    "audit" {
        $trail = GetAuditTrail -Limit 20
        $trail | ConvertTo-Json | Write-Host
    }
    
    default {
        Write-Host "NOUR OS Orchestrator"
        Write-Host ""
        Write-Host "Usage: orchestrator.ps1 <command> [args]"
        Write-Host ""
        Write-Host "Commands:"
        Write-Host "  status          Show orchestrator status"
        Write-Host "  exec <cmd>      Execute a command"
        Write-Host "  exec-dry <cmd>  Dry run a command"
        Write-Host "  audit           Show audit trail (last 20 entries)"
    }
}
