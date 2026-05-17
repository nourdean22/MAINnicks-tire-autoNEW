# NOUR OS System Monitor - Disk usage, process health, uptime
# Monitors system resources and writes metrics to JSON

param(
    [string]$Command = "collect",
    [string]$Metric = "all"
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$MonitorDir = Join-Path -Path $RootDir -ChildPath "workspace" | ForEach-Object { Join-Path -Path $_ -ChildPath "monitor" }
$MetricsFile = Join-Path -Path $MonitorDir -ChildPath "metrics.jsonl"
$HealthFile = Join-Path -Path $MonitorDir -ChildPath "health.json"
$LogsDir = Join-Path -Path $RootDir -ChildPath "logs"
$AuditLog = Join-Path -Path $LogsDir -ChildPath "audit.jsonl"

# Ensure directories
if (-not (Test-Path $MonitorDir)) {
    New-Item -ItemType Directory -Path $MonitorDir -Force | Out-Null
}

<#
.FUNCTION LogMonitorEvent
.DESCRIPTION Log monitoring operations
#>
function LogMonitorEvent {
    param(
        [string]$Action,
        [hashtable]$Details
    )
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $entry = @{
        type = "monitor_event"
        action = $Action
        timestamp = $timestamp
        details = $Details
    }
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -Path $AuditLog -Value $json
}

<#
.FUNCTION GetDiskUsage
.DESCRIPTION Get disk usage metrics
#>
function GetDiskUsage {
    $drives = Get-Volume | Where-Object { $null -ne $_.DriveLetter }
    $diskMetrics = @()
    
    foreach ($drive in $drives) {
        $letter = $drive.DriveLetter
        if ($null -ne $letter) {
            $info = Get-Item "$($letter):\" -Force
            $totalSize = $drive.Size
            $freeSpace = $drive.SizeRemaining
            $usedSpace = $totalSize - $freeSpace
            $usedPercent = if ($totalSize -gt 0) { [Math]::Round(($usedSpace / $totalSize) * 100, 2) } else { 0 }
            
            $diskMetrics += @{
                drive = "$($letter):"
                total_gb = [Math]::Round($totalSize / 1GB, 2)
                used_gb = [Math]::Round($usedSpace / 1GB, 2)
                free_gb = [Math]::Round($freeSpace / 1GB, 2)
                used_percent = $usedPercent
            }
        }
    }
    
    return $diskMetrics
}

<#
.FUNCTION GetProcessHealth
.DESCRIPTION Get process health metrics
#>
function GetProcessHealth {
    $processes = Get-Process | Where-Object { $_.WorkingSet -gt 10MB }
    
    $topProcesses = $processes | Sort-Object -Property WorkingSet -Descending | Select-Object -First 10
    
    $processMetrics = @()
    foreach ($proc in $topProcesses) {
        $processMetrics += @{
            name = $proc.Name
            pid = $proc.Id
            memory_mb = [Math]::Round($proc.WorkingSet / 1MB, 2)
            cpu_percent = if ($null -ne $proc.CPU) { [Math]::Round($proc.CPU, 2) } else { 0 }
            threads = $proc.Threads.Count
        }
    }
    
    return @{
        total_processes = (Get-Process).Count
        high_memory_processes = $processMetrics
    }
}

<#
.FUNCTION GetSystemUptime
.DESCRIPTION Get system uptime
#>
function GetSystemUptime {
    $os = Get-WmiObject Win32_OperatingSystem
    $lastBootTime = [Management.ManagementDateTimeConverter]::ToDateTime($os.LastBootUpTime)
    $uptime = [DateTime]::UtcNow - $lastBootTime
    
    return @{
        last_boot = $lastBootTime.ToString("o")
        uptime_days = $uptime.Days
        uptime_hours = $uptime.Hours
        uptime_minutes = $uptime.Minutes
        uptime_total_seconds = [Math]::Round($uptime.TotalSeconds)
    }
}

<#
.FUNCTION GetMemoryUsage
.DESCRIPTION Get memory usage metrics
#>
function GetMemoryUsage {
    $os = Get-WmiObject Win32_OperatingSystem
    
    $totalMemory = $os.TotalVisibleMemorySize * 1KB
    $freeMemory = $os.FreePhysicalMemory * 1KB
    $usedMemory = $totalMemory - $freeMemory
    $usedPercent = [Math]::Round(($usedMemory / $totalMemory) * 100, 2)
    
    return @{
        total_gb = [Math]::Round($totalMemory / 1GB, 2)
        used_gb = [Math]::Round($usedMemory / 1GB, 2)
        free_gb = [Math]::Round($freeMemory / 1GB, 2)
        used_percent = $usedPercent
    }
}

<#
.FUNCTION CollectMetrics
.DESCRIPTION Collect all system metrics
#>
function CollectMetrics {
    $timestamp = [DateTime]::UtcNow
    
    $metrics = @{
        timestamp = $timestamp.ToString("o")
        disk = GetDiskUsage
        memory = GetMemoryUsage
        processes = GetProcessHealth
        uptime = GetSystemUptime
    }
    
    # Write to metrics log
    $metrics | ConvertTo-Json | Add-Content -Path $MetricsFile
    
    # Write to health file (latest)
    $metrics | ConvertTo-Json | Set-Content -Path $HealthFile
    
    LogMonitorEvent "metrics_collected" @{
        disk_metrics = $metrics.disk.Count
        timestamp = $timestamp.ToString("o")
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Metrics collected"
        metrics = $metrics
    })
}

<#
.FUNCTION GetHealthStatus
.DESCRIPTION Get current health status
#>
function GetHealthStatus {
    if (Test-Path $HealthFile) {
        $health = Get-Content -Path $HealthFile -Raw | ConvertFrom-Json
    } else {
        $health = @{}
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        health = $health
    })
}

<#
.FUNCTION GetMetricsHistory
.DESCRIPTION Get metrics history (recent entries)
#>
function GetMetricsHistory {
    param([int]$Limit = 100)
    
    if (Test-Path $MetricsFile) {
        $history = @()
        Get-Content -Path $MetricsFile | ForEach-Object {
            $entry = $_ | ConvertFrom-Json
            $history += $entry
        }
        
        $history = $history | Sort-Object -Property timestamp -Descending | Select-Object -First $Limit
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
.FUNCTION InitializeMonitor
.DESCRIPTION Initialize monitoring directory
#>
function InitializeMonitor {
    if (-not (Test-Path $MonitorDir)) {
        New-Item -ItemType Directory -Path $MonitorDir -Force | Out-Null
    }
    
    # Collect initial metrics
    CollectMetrics
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Monitor initialized"
        path = $MonitorDir
    })
}

# Main command router
switch ($Command.ToLower()) {
    "init" {
        InitializeMonitor
    }
    "collect" {
        CollectMetrics
    }
    "health" {
        GetHealthStatus
    }
    "history" {
        GetMetricsHistory
    }
    default {
        Write-Host (ConvertTo-Json @{
            error = "Unknown command"
            available = @("init", "collect", "health", "history")
        })
    }
}
