# NOUR OS Alert Rules - Thresholds, notifications, enforcement
# Evaluates metrics against rules and triggers actions

param(
    [string]$Command = "check",
    [string]$RuleName = ""
)

$ErrorActionPreference = "Continue"

# Paths
$RootDir = Split-Path (Split-Path $PSCommandPath)
$AlertDir = Join-Path -Path $RootDir -ChildPath "workspace" | ForEach-Object { Join-Path -Path $_ -ChildPath "alerts" }
$RulesFile = Join-Path -Path $AlertDir -ChildPath "rules.json"
$AlertsLogFile = Join-Path -Path $AlertDir -ChildPath "alerts.jsonl"
$MonitorDir = Join-Path -Path $RootDir -ChildPath "workspace" | ForEach-Object { Join-Path -Path $_ -ChildPath "monitor" }
$HealthFile = Join-Path -Path $MonitorDir -ChildPath "health.json"
$LogsDir = Join-Path -Path $RootDir -ChildPath "logs"
$AuditLog = Join-Path -Path $LogsDir -ChildPath "audit.jsonl"

# Ensure directories
if (-not (Test-Path $AlertDir)) {
    New-Item -ItemType Directory -Path $AlertDir -Force | Out-Null
}

<#
.FUNCTION LogAlertEvent
.DESCRIPTION Log alert operations
#>
function LogAlertEvent {
    param(
        [string]$Action,
        [hashtable]$Details,
        [string]$Level = "info"
    )
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    $entry = @{
        type = "alert_event"
        action = $Action
        timestamp = $timestamp
        level = $Level
        details = $Details
    }
    $json = $entry | ConvertTo-Json -Compress
    Add-Content -Path $AuditLog -Value $json
}

<#
.FUNCTION LoadRules
.DESCRIPTION Load alert rules from storage
#>
function LoadRules {
    if (Test-Path $RulesFile) {
        $rules = Get-Content -Path $RulesFile -Raw | ConvertFrom-Json
        if ($null -eq $rules) { $rules = @() }
    } else {
        $rules = @()
    }
    return $rules
}

<#
.FUNCTION SaveRules
.DESCRIPTION Save alert rules to storage
#>
function SaveRules {
    param([array]$Rules)
    
    $Rules | ConvertTo-Json | Set-Content -Path $RulesFile
}

<#
.FUNCTION CreateRule
.DESCRIPTION Create a new alert rule
#>
function CreateRule {
    param(
        [string]$Name,
        [string]$Metric,
        [string]$Operator,
        [float]$Threshold,
        [string]$Action
    )
    
    $rules = LoadRules
    
    $rule = @{
        id = [guid]::NewGuid().ToString()
        name = $Name
        metric = $Metric
        operator = $Operator
        threshold = $Threshold
        action = $Action
        enabled = $true
        created_at = [DateTime]::UtcNow.ToString("o")
        last_triggered = $null
        trigger_count = 0
    }
    
    $rules += $rule
    SaveRules $rules
    
    LogAlertEvent "rule_created" @{
        rule_id = $rule.id
        name = $Name
        metric = $Metric
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Rule created"
        rule_id = $rule.id
    })
}

<#
.FUNCTION EvaluateRule
.DESCRIPTION Evaluate a single rule against current metrics
#>
function EvaluateRule {
    param(
        [hashtable]$Rule,
        [hashtable]$Metrics
    )
    
    if (-not $Rule.enabled) {
        return @{
            rule_id = $Rule.id
            triggered = $false
            reason = "disabled"
        }
    }
    
    # Extract metric value based on metric path
    $value = $null
    $metricPath = $Rule.metric -split '\.'
    $current = $Metrics
    
    foreach ($segment in $metricPath) {
        if ($null -eq $current) { break }
        $current = $current.$segment
    }
    
    $value = $current
    
    if ($null -eq $value) {
        return @{
            rule_id = $Rule.id
            triggered = $false
            reason = "metric_not_found"
        }
    }
    
    # Evaluate against operator
    $triggered = $false
    switch ($Rule.operator.ToLower()) {
        "greater_than" { $triggered = $value -gt $Rule.threshold }
        "greater_equal" { $triggered = $value -ge $Rule.threshold }
        "less_than" { $triggered = $value -lt $Rule.threshold }
        "less_equal" { $triggered = $value -le $Rule.threshold }
        "equal" { $triggered = $value -eq $Rule.threshold }
        "not_equal" { $triggered = $value -ne $Rule.threshold }
    }
    
    return @{
        rule_id = $Rule.id
        rule_name = $Rule.name
        triggered = $triggered
        metric = $Rule.metric
        metric_value = $value
        threshold = $Rule.threshold
        operator = $Rule.operator
    }
}

<#
.FUNCTION ExecuteAction
.DESCRIPTION Execute alert action
#>
function ExecuteAction {
    param(
        [string]$Action,
        [hashtable]$RuleData,
        [hashtable]$Rule
    )
    
    $timestamp = [DateTime]::UtcNow.ToString("o")
    
    switch ($Action.ToLower()) {
        "log" {
            LogAlertEvent "rule_triggered" @{
                rule_id = $Rule.id
                rule_name = $Rule.name
                metric = $RuleData.metric
                metric_value = $RuleData.metric_value
                threshold = $Rule.threshold
            } "warning"
            
            return @{
                status = "executed"
                action = "log"
                message = "Alert logged"
            }
        }
        "notify" {
            $notification = @{
                timestamp = $timestamp
                rule_id = $Rule.id
                rule_name = $Rule.name
                message = "Alert: $($Rule.name) triggered. Metric: $($RuleData.metric_value), Threshold: $($Rule.threshold)"
            }
            
            # Write to alerts log
            $notification | ConvertTo-Json | Add-Content -Path $AlertsLogFile
            
            LogAlertEvent "alert_triggered" @{
                rule_id = $Rule.id
                action = "notify"
            } "warning"
            
            return @{
                status = "executed"
                action = "notify"
                message = "Alert notification sent"
            }
        }
        "escalate" {
            LogAlertEvent "alert_escalated" @{
                rule_id = $Rule.id
                rule_name = $Rule.name
                metric = $RuleData.metric_value
            } "error"
            
            return @{
                status = "executed"
                action = "escalate"
                message = "Alert escalated"
            }
        }
        default {
            return @{
                status = "error"
                message = "Unknown action"
                action = $Action
            }
        }
    }
}

<#
.FUNCTION CheckAllRules
.DESCRIPTION Evaluate all enabled rules against current metrics
#>
function CheckAllRules {
    if (-not (Test-Path $HealthFile)) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "No metrics available"
        })
        return
    }
    
    $metrics = Get-Content -Path $HealthFile -Raw | ConvertFrom-Json
    $rules = LoadRules
    
    $results = @()
    $triggeredCount = 0
    
    foreach ($rule in $rules) {
        $evaluation = EvaluateRule -Rule $rule -Metrics $metrics
        
        if ($evaluation.triggered) {
            $triggeredCount++
            $rule.last_triggered = [DateTime]::UtcNow.ToString("o")
            $rule.trigger_count += 1
            
            $actionResult = ExecuteAction -Action $rule.action -RuleData $evaluation -Rule $rule
            $evaluation.action_result = $actionResult
        }
        
        $results += $evaluation
    }
    
    SaveRules $rules
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        timestamp = [DateTime]::UtcNow.ToString("o")
        total_rules = $rules.Count
        triggered = $triggeredCount
        evaluations = $results
    })
}

<#
.FUNCTION ListRules
.DESCRIPTION List all alert rules
#>
function ListRules {
    $rules = LoadRules
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        count = $rules.Count
        rules = $rules
    })
}

<#
.FUNCTION DisableRule
.DESCRIPTION Disable an alert rule
#>
function DisableRule {
    param([string]$RuleName)
    
    $rules = LoadRules
    $rule = $rules | Where-Object { $_.id -eq $RuleName -or $_.name -eq $RuleName } | Select-Object -First 1
    
    if ($null -eq $rule) {
        Write-Host (ConvertTo-Json @{
            status = "error"
            message = "Rule not found"
        })
        return
    }
    
    $rule.enabled = $false
    SaveRules $rules
    
    LogAlertEvent "rule_disabled" @{
        rule_id = $rule.id
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Rule disabled"
    })
}

<#
.FUNCTION InitializeAlerts
.DESCRIPTION Initialize alert system
#>
function InitializeAlerts {
    if (-not (Test-Path $AlertDir)) {
        New-Item -ItemType Directory -Path $AlertDir -Force | Out-Null
    }
    
    # Create default rules
    $defaultRules = @(
        @{
            id = [guid]::NewGuid().ToString()
            name = "High Disk Usage"
            metric = "disk"
            operator = "greater_than"
            threshold = 80
            action = "log"
            enabled = $true
            created_at = [DateTime]::UtcNow.ToString("o")
            last_triggered = $null
            trigger_count = 0
        },
        @{
            id = [guid]::NewGuid().ToString()
            name = "High Memory Usage"
            metric = "memory.used_percent"
            operator = "greater_than"
            threshold = 85
            action = "notify"
            enabled = $true
            created_at = [DateTime]::UtcNow.ToString("o")
            last_triggered = $null
            trigger_count = 0
        }
    )
    
    SaveRules $defaultRules
    
    LogAlertEvent "alerts_initialized" @{
        default_rules = $defaultRules.Count
    }
    
    Write-Host (ConvertTo-Json @{
        status = "success"
        message = "Alert system initialized"
        path = $AlertDir
        default_rules = $defaultRules.Count
    })
}

# Main command router
switch ($Command.ToLower()) {
    "init" {
        InitializeAlerts
    }
    "check" {
        CheckAllRules
    }
    "create" {
        CreateRule -Name $RuleName -Metric "test" -Operator "greater_than" -Threshold 80 -Action "log"
    }
    "list" {
        ListRules
    }
    "disable" {
        DisableRule -RuleName $RuleName
    }
    default {
        Write-Host (ConvertTo-Json @{
            error = "Unknown command"
            available = @("init", "check", "create", "list", "disable")
        })
    }
}
