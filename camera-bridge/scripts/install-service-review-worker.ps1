<#
.SYNOPSIS
Install the offline outside-service review worker as a durable scheduled task.

.DESCRIPTION
This is a separate low-priority consumer of NO_BAY_ACTIVITY_REVIEW clips.
It never mutates vehicle visits, bay state, work orders, or the live capture loop.
The task is one-shot, non-overlapping, and idempotent unless the worker is explicitly
run with --force by a human outside this installer.
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [string]$TaskName = "NickOutsideServiceReview",
    [string]$PythonPath = "",
    [string]$CasesDir = "",
    [string]$Ledger = "",
    [int]$IntervalMinutes = 15,
    [double]$EverySeconds = 3.0,
    [string]$Device = "",
    [double]$Threshold = 0.30,
    [double]$TextThreshold = 0.25,
    [string]$Model = "IDEA-Research/grounding-dino-tiny",
    [string]$Revision = "a2bb814dd30d776dcf7e30523b00659f4f141c71"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if (-not $CasesDir) { $CasesDir = Join-Path $root "data\hard-cases" }
if (-not $Ledger) { $Ledger = Join-Path $CasesDir "service-evidence.jsonl" }
$logDir = Join-Path $root "logs"
$taskSlug = ($TaskName -replace '[^A-Za-z0-9._-]', '_')
$wrapper = Join-Path $root ("service-review-task-" + $taskSlug + ".cmd")
$logFile = Join-Path $logDir ("service-review-" + $taskSlug + ".log")

function Quote-Cmd([string]$value) {
    if ($value -match "[\r\n]") { throw "Refusing value containing newline." }
    return '"' + ($value -replace '%', '%%') + '"'
}

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -ne $existing) {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }
    if (Test-Path $wrapper) { Remove-Item -Path $wrapper -Force }
    Write-Host "Outside-service review task '$TaskName' removed." -ForegroundColor Green
    exit 0
}

if ($IntervalMinutes -lt 5) { throw "IntervalMinutes must be >= 5." }
if ($EverySeconds -lt 0) { throw "EverySeconds must be >= 0." }
if ($Threshold -le 0 -or $Threshold -gt 1) { throw "Threshold must be in (0, 1]." }
if ($TextThreshold -le 0 -or $TextThreshold -gt 1) { throw "TextThreshold must be in (0, 1]." }

if (-not $PythonPath) {
    $guess = Join-Path $root ".venv-service-review\Scripts\python.exe"
    if (Test-Path $guess) { $PythonPath = $guess }
}
if (-not $PythonPath -or -not (Test-Path $PythonPath)) {
    throw "Service-review Python not found. Create .venv-service-review and pass -PythonPath."
}

if (-not (Test-Path $CasesDir)) { New-Item -ItemType Directory -Path $CasesDir -Force | Out-Null }
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

$rootForPython = $root.Replace("\", "\\").Replace("'", "\'")
$preflight = "import sys; sys.path.insert(0, r'$rootForPython'); import torch, transformers; from PIL import Image; from vision.service_review_worker import MODEL_ID, MODEL_REVISION; print(sys.version.split()[0]); print(torch.__version__); print(transformers.__version__); print(MODEL_ID); print(MODEL_REVISION)"
$preflightOut = & $PythonPath -c $preflight 2>&1
if ($LASTEXITCODE -ne 0) {
    throw ("Service-review Python preflight failed. Install the correct PyTorch build, then " +
           "pip install -r requirements-service-review.txt. Detail: " + ($preflightOut -join " "))
}

$pythonQ = Quote-Cmd $PythonPath
$rootQ = Quote-Cmd $root
$casesQ = Quote-Cmd $CasesDir
$ledgerQ = Quote-Cmd $Ledger
$modelQ = Quote-Cmd $Model
$revisionQ = Quote-Cmd $Revision
$logQ = Quote-Cmd $logFile
$deviceArg = if ($Device) { " --device " + (Quote-Cmd $Device) } else { "" }

$wrapperBody = @"
@echo off
setlocal
cd /d $rootQ
echo. >> $logQ
echo ==== service review start %DATE% %TIME% ==== >> $logQ
$pythonQ -m vision.service_review_worker --cases-dir $casesQ --ledger $ledgerQ --model $modelQ --revision $revisionQ$deviceArg --threshold $Threshold --text-threshold $TextThreshold --every-seconds $EverySeconds >> $logQ 2>&1
set RC=%ERRORLEVEL%
echo ==== service review exit %RC% %DATE% %TIME% ==== >> $logQ
exit /b %RC%
"@

if ($DryRun) {
    Write-Host "DRY RUN -- no task or wrapper was changed." -ForegroundColor Cyan
    Write-Host "Task: $TaskName every $IntervalMinutes min, MultipleInstances=IgnoreNew, Priority=7"
    Write-Host "Cases: $CasesDir"
    Write-Host "Ledger: $Ledger"
    Write-Host $wrapperBody
    exit 0
}

Set-Content -Path $wrapper -Value $wrapperBody -Encoding ASCII

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $root
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$repeatTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 7
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($logonTrigger, $repeatTrigger) -Settings $settings -Principal $principal -Force | Out-Null

Write-Host "Registered '$TaskName'." -ForegroundColor Green
Write-Host "  every:      $IntervalMinutes minute(s)"
Write-Host "  cases:      $CasesDir"
Write-Host "  ledger:     $Ledger"
Write-Host "  model:      $Model@$Revision"
Write-Host "  overlap:    IgnoreNew"
Write-Host "  authority:  shadow_only"
Write-Host "  log:        $logFile"
Write-Host "Start now: Start-ScheduledTask -TaskName '$TaskName'"
