# NOUR OS Task Scheduler - Job queue, interval scheduling, triggers
# Manages execution of scheduled tasks with full audit trail

param(
    [string]$Command = "",
    [string]$TaskName = "",
    [string]$Schedule = "",
    [string]$Script = ""
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$SchedulerDir = Join-Path -Path $RootDir -ChildPath "workspace" | ForEach-Object { Join-Path -Path $_ -ChildPath "scheduler" }
$JobsFile = Join-Path -Path $SchedulerDir -ChildPath "jobs.json"
$JobQueueFile = Join-Path -Path $SchedulerDir -ChildPath "queue.jsonl"
$JobHistoryFile = Join-Path -Path $SchedulerDir -ChildPath "history.jsonl"
$LogsDir = Join-Path -Path $RootDir -ChildPath "logs"
$AuditLog = Join-Path -Path $LogsDir -ChildPath "audit.jsonl"

# Ensure directories
if (-not (Test-Path $SchedulerDir)) {
    New-Item -ItemType Directory -Path $SchedulerDir -Force | Out-Null
}

<#
.FUNCTION LogSchedulerEvent
.DESCRIPTION Log scheduler operations to audit trail
#>
function LogSchedulerEvent {
    param(
        [string]$Action,
        [hashtable]$Details
    )
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $entry = @{
        type = "scheduler_event"
        action = $Action
        timestamp = $timestamp
        details = $Details
    }
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -Path $AuditLog -Value $json
}

<#
.FUNCTION LoadJobs
.DESCRIPTION Load all scheduled jobs from storage
#>
function LoadJobs {
    if (Test-Path $JobsFile) {
        $jobs = Get-Content -Path $JobsFile -Raw | ConvertFrom-Json
        if ($null -eq $jobs) { $jobs = @() }
    } else {
        $jobs = @()
    }
    return $jobs
}

<#
.FUNCTION SaveJobs
.DESCRIPTION Save jobs to storage
#>
function SaveJobs {
    param([array]$Jobs)
    
    $Jobs | ConvertTo-Json | Set-Content -Path $JobsFile
}

<#
.FUNCTION CreateJob
.DESCRIPTION Create a new scheduled job
#>
function CreateJob {
    param(
        [string]$Name,
        [string]$ScheduleType,
        [string]$ScheduleValue,
        [string]$ScriptPath
    )
    
    if (-not (Test-Path $ScriptPath)) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Script file not found"
            path = $ScriptPath
        })
        return
    }
    
    $jobs = LoadJobs
    
    $job = @{
        id = [guid]::NewGuid().ToString()
        name = $Name
        type = $ScheduleType
        schedule = $ScheduleValue
        script_path = $ScriptPath
        enabled = $true
        created_at = [DateTime]::UtcNow.ToString("o")
        last_run = $null
        last_status = "pending"
        run_count = 0
    }
    
    $jobs += $job
    SaveJobs $jobs
    
    LogSchedulerEvent "job_created" @{
        job_id = $job.id
        name = $Name
        type = $ScheduleType
        schedule = $ScheduleValue
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Job created"
        job_id = $job.id
    })
}

<#
.FUNCTION ListJobs
.DESCRIPTION List all scheduled jobs
#>
function ListJobs {
    $jobs = LoadJobs
    
    if ($jobs.Count -eq 0) {
        Write-Host (ConvertTo-Json @{
            status = "success"
            count = 0
            jobs = @()
        })
    } else {
        Write-Host (ConvertTo-Json @{
            status = "success"
            count = $jobs.Count
            jobs = $jobs
        })
    }
}

<#
.FUNCTION GetJobStatus
.DESCRIPTION Get status of a specific job
#>
function GetJobStatus {
    param([string]$JobId)
    
    $jobs = LoadJobs
    $job = $jobs | Where-Object { $_.id -eq $JobId } | Select-Object -First 1
    
    if ($null -eq $job) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Job not found"
            job_id = $JobId
        })
        return
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        job = $job
    })
}

<#
.FUNCTION ExecuteJob
.DESCRIPTION Execute a job immediately
#>
function ExecuteJob {
    param([string]$JobId)
    
    $jobs = LoadJobs
    $job = $jobs | Where-Object { $_.id -eq $JobId } | Select-Object -First 1
    
    if ($null -eq $job) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Job not found"
            job_id = $JobId
        })
        return
    }
    
    if (-not $job.enabled) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Job is disabled"
            job_id = $JobId
        })
        return
    }
    
    $startTime = [DateTime]::UtcNow
    $execution = @{
        job_id = $JobId
        job_name = $job.name
        started_at = $startTime.ToString("o")
        status = "running"
    }
    
    $execution | ConvertTo-Json | Add-Content -Path $JobQueueFile
    
    LogSchedulerEvent "job_execution_started" @{
        job_id = $JobId
        job_name = $job.name
    }
    
    # Execute the script
    $result = @{
        exit_code = 0
        output = ""
        error = ""
    }
    
    try {
        $output = & $job.script_path 2>&1
        $result.output = $output | Out-String
        $result.exit_code = 0
        $execution.status = "success"
    }
    catch {
        $result.error = $_.Exception.Message
        $result.exit_code = 1
        $execution.status = "failed"
    }
    
    $endTime = [DateTime]::UtcNow
    $duration = ($endTime - $startTime).TotalSeconds
    
    $execution.ended_at = $endTime.ToString("o")
    $execution.duration_seconds = $duration
    $execution.result = $result
    
    # Update job tracking
    $job.last_run = $endTime.ToString("o")
    $job.last_status = $execution.status
    $job.run_count += 1
    
    SaveJobs $jobs
    
    $execution | ConvertTo-Json | Add-Content -Path $JobHistoryFile
    
    LogSchedulerEvent "job_execution_completed" @{
        job_id = $JobId
        status = $execution.status
        duration_seconds = $duration
        exit_code = $result.exit_code
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Job executed"
        execution = $execution
    })
}

<#
.FUNCTION DisableJob
.DESCRIPTION Disable a job
#>
function DisableJob {
    param([string]$JobId)
    
    $jobs = LoadJobs
    $job = $jobs | Where-Object { $_.id -eq $JobId } | Select-Object -First 1
    
    if ($null -eq $job) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Job not found"
        })
        return
    }
    
    $job.enabled = $false
    SaveJobs $jobs
    
    LogSchedulerEvent "job_disabled" @{
        job_id = $JobId
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Job disabled"
    })
}

<#
.FUNCTION GetExecutionHistory
.DESCRIPTION Get job execution history
#>
function GetExecutionHistory {
    param([int]$Limit = 100)
    
    if (Test-Path $JobHistoryFile) {
        $history = @()
        Get-Content -Path $JobHistoryFile | ForEach-Object {
            $entry = $_ | ConvertFrom-Json
            $history += $entry
        }
        
        $history = $history | Sort-Object -Property started_at -Descending | Select-Object -First $Limit
    } else {
        $history = @()
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        count = $history.Count
        history = $history
    })
}

<#
.FUNCTION InitializeScheduler
.DESCRIPTION Initialize scheduler directory and files
#>
function InitializeScheduler {
    if (-not (Test-Path $SchedulerDir)) {
        New-Item -ItemType Directory -Path $SchedulerDir -Force | Out-Null
    }
    
    "[]" | Set-Content -Path $JobsFile
    
    LogSchedulerEvent "scheduler_initialized" @{
        timestamp = [DateTime]::UtcNow.ToString("o")
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Scheduler initialized"
        path = $SchedulerDir
    })
}

# Main command router
switch ($Command.ToLower()) {
    "init" {
        InitializeScheduler
    }
    "create" {
        CreateJob -Name $TaskName -ScheduleType $Schedule -ScheduleValue "" -ScriptPath $Script
    }
    "list" {
        ListJobs
    }
    "status" {
        GetJobStatus -JobId $TaskName
    }
    "execute" {
        ExecuteJob -JobId $TaskName
    }
    "disable" {
        DisableJob -JobId $TaskName
    }
    "history" {
        GetExecutionHistory
    }
    default {
        Write-Host (ConvertTo-Json @{
            error = "Unknown command"
            available = @("init", "create", "list", "status", "execute", "disable", "history")
        })
    }
}
