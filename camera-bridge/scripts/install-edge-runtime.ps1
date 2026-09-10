<#
.SYNOPSIS
    Register the durable edge runtime (edge_main.py) as a Scheduled Task that survives logon.
.DESCRIPTION
    WHY AT LOGON AND NEVER AS SYSTEM. The WGC capture lane reads a window on the
    INTERACTIVE DESKTOP. Windows services run in Session 0, which has no desktop at all, so
    a SYSTEM task would start, find no window, and stall forever while looking perfectly
    healthy in Task Scheduler. Once RTSP is proven on these cameras a headless variant
    becomes possible and this comment should be revisited; until then, logon is not a
    limitation to work around, it is the requirement.

    TWO SUPERVISION LAYERS, deliberately:
      * The OS restarts a process that DIED         (RestartCount / RestartInterval below).
      * The process exits 3 when it is ALIVE but its source stopped delivering
        (`--stall-exit-seconds` in edge_main), which the OS layer cannot see.
    A frozen-but-delivering camera is NOT a stall: that is reported as degraded vision, and
    restarting on it would loop against a dirty lens.

    THE SECRET IS NEVER STORED IN PLAINTEXT NEXT TO THE CODE. `-EncryptSecret` reads
    CAMERA_INGEST_KEY from camera-bridge/.env.local once and writes a DPAPI blob
    (secrets/camera-ingest.xml) that only THIS user on THIS machine can decrypt. The
    generated wrapper decrypts it into the child process's environment at start, so the key
    never reaches a command line (visible in Task Manager) or a log.
.EXAMPLE
    powershell -File scripts/install-edge-runtime.ps1 -EncryptSecret
    powershell -File scripts/install-edge-runtime.ps1 -Calibration .\scratchpad\shopsign_calibration.json
    powershell -File scripts/install-edge-runtime.ps1 -DryRun
    powershell -File scripts/install-edge-runtime.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$EncryptSecret,
    [string]$TaskName = "NickEdgeProducer",
    [string]$PythonPath = "",
    [string]$ConfigPath = "",
    [string]$Calibration = "",
    [string]$Model = "",
    [string]$Device = "AUTO",
    [string]$Camera = "sign",
    [double]$Fps = 4.0,
    [double]$HeartbeatSeconds = 30.0,
    [double]$StallExitSeconds = 180.0,
    # EVERY CAPABILITY ADDED TO THE PRODUCER NEEDS A ROUTE THROUGH HERE, or it exists only
    # for whoever hand-runs edge_main.py. Scene localisation, the hard-case corpus, the
    # shadow ledger and the replay lane were all shipped, tested and live-verified while
    # being unreachable from the installed scheduled task -- which is the only way this
    # producer actually runs unattended. `EdgeInstallerFlagDriftTest` now fails when a
    # producer flag has no route here.
    [string]$SceneAtlas = "",
    [string]$Scene = "",
    [int]$Channel = -1,
    [string]$HardCases = "",
    [double]$HardCaseMaxGb = 2.0,
    [ValidateSet("", "off", "both", "replace")]
    [string]$HardCaseEpisodes = "",
    [double]$RelocateSeconds = 120.0,
    [string]$ShadowLedger = "",
    [string]$ChallengerModel = "",
    [string]$AdjudicatorModel = "",
    [string]$AdjudicatorDevice = "",
    [string]$Evidence = "",
    [string]$Ledger = "",
    [switch]$Replay,
    [string]$Source = "",
    [string]$WindowTitle = "",
    [switch]$NoCrop,
    [string]$Mode = "",
    [string]$CommissioningRun = "",
    [double]$DrainSeconds = -1,
    [double]$PersistSeconds = -1,
    # NOT the installer's own -DryRun (which prints the plan and installs nothing). This one
    # is the PRODUCER's --dry-run. Naming both $DryRun made -DryRun silently bake --dry-run
    # into the installed wrapper -- an install preview would have changed what got installed.
    [switch]$ProducerDryRun,
    [string]$LogLevel = "",
    # Last-resort escape hatch so a new producer flag is usable the day it lands, before
    # anyone adds a typed parameter for it. Passed through verbatim.
    [string]$ExtraArgs = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "edge.log"
$wrapper = Join-Path $root "edge-task.cmd"
$secretDir = Join-Path $root "secrets"
$secretFile = Join-Path $secretDir "camera-ingest.xml"
if (-not $ConfigPath) { $ConfigPath = Join-Path $root "config.yaml" }

function Write-Step($msg) { Write-Host "  $msg" }

if ($Uninstall) {
    $existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $existing) { Write-Host "Task '$TaskName' is not registered." } else {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "Task '$TaskName' removed." -ForegroundColor Green
    }
    if (Test-Path $wrapper) { Remove-Item -Path $wrapper -Force }
    # The DPAPI blob is deliberately LEFT: uninstalling a task is not a reason to make the
    # operator re-enter a secret. Delete secrets\camera-ingest.xml by hand to revoke.
    exit 0
}

# --- Secret: encrypt once, from the file the operator already has ------------
if ($EncryptSecret) {
    $envFile = Join-Path $root ".env.local"
    if (-not (Test-Path $envFile)) { throw "$envFile not found. Create it with a CAMERA_INGEST_KEY=... line first." }
    $line = Select-String -Path $envFile -Pattern '^CAMERA_INGEST_KEY=' | Select-Object -First 1
    if (-not $line) { throw "$envFile has no CAMERA_INGEST_KEY= line." }
    $value = ($line.Line -split '=', 2)[1].Trim()
    if (-not $value) { throw "CAMERA_INGEST_KEY in $envFile is empty." }
    if (-not (Test-Path $secretDir)) { New-Item -ItemType Directory -Path $secretDir | Out-Null }
    # DPAPI: ConvertTo-SecureString + Export-Clixml ties the blob to this user AND this
    # machine. Copying the file to another box, or reading it as another user, fails.
    ConvertTo-SecureString -String $value -AsPlainText -Force | Export-Clixml -Path $secretFile
    Write-Host "Secret encrypted to $secretFile (DPAPI: this user, this machine)." -ForegroundColor Green
    Write-Host "You can now delete the plaintext CAMERA_INGEST_KEY line from .env.local if you want." -ForegroundColor Yellow
}

# --- Preflight ---------------------------------------------------------------
function Resolve-Python {
    if ($PythonPath) {
        if (-not (Test-Path $PythonPath)) { throw "PythonPath '$PythonPath' does not exist." }
        return $PythonPath
    }
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    throw "python not found. Install Python 3.12+ and add it to PATH, or pass -PythonPath."
}
$python = Resolve-Python
$version = (& $python -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
if ([version]$version -lt [version]"3.12") { throw "Python $version at $python is too old; the edge runtime needs 3.12+." }

if (-not (Test-Path $ConfigPath)) {
    throw "Config '$ConfigPath' not found. Run: cp config.example.yaml config.yaml, then set backend.shopUrl and cameras.$Camera"
}
if ($Calibration -and -not (Test-Path $Calibration)) { throw "Calibration '$Calibration' not found." }

# THE DETECTOR IS NOT OPTIONAL FOR ARRIVALS. Without a model `build_council()` returns a
# council with no primary detector, whose `can_confirm_arrival` is always False -- so the
# pipeline rejects every candidate and NO arrival is ever emitted, however good the
# calibration is. A task installed without one would run for weeks looking healthy and
# never record a single visit.
if (-not $Model -and $env:VISION_OV_MODEL) { $Model = $env:VISION_OV_MODEL }
if (-not $Model) {
    $guess = Join-Path $root "ov_models\vehicle-detection-0200\FP16\vehicle-detection-0200.xml"
    if (Test-Path $guess) {
        $Model = $guess
        Write-Host "Using the fetched model at $Model" -ForegroundColor Green
    }
}
if ($Model -and -not (Test-Path $Model)) { throw "Model '$Model' not found. Fetch it: python -m vision.fetch_models --dest ov_models" }
if (-not $Model) {
    Write-Host "WARNING: no -Model and none found under ov_models. The producer will run" -ForegroundColor Red
    Write-Host "         MOTION-ONLY and can never confirm an arrival -- it will look healthy" -ForegroundColor Red
    Write-Host "         and record nothing. Fetch one first:" -ForegroundColor Red
    Write-Host "           python -m vision.fetch_models --dest ov_models" -ForegroundColor Red
}
if (-not $Calibration) {
    Write-Host "NOTE: no -Calibration. The producer will run in CENSUS MODE: occupancy and health only," -ForegroundColor Yellow
    Write-Host "      no arrival can be claimed, and the shop will show the camera as CALIBRATION_INVALID." -ForegroundColor Yellow
}
if (-not (Test-Path $secretFile)) {
    Write-Host "NOTE: no encrypted secret at $secretFile. Run with -EncryptSecret, or the producer" -ForegroundColor Yellow
    Write-Host "      will persist visits locally and queue them, but the shop admin will not update." -ForegroundColor Yellow
}
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# --- Wrapper ----------------------------------------------------------------
# Paths go into the wrapper as QUOTED cmd.exe tokens, never interpolated into an argument
# string: a path containing & | ^ % would otherwise be re-parsed by cmd. Same rule the
# visitd installer learned (its issue 9).
foreach ($p in @($python, $root, $ConfigPath, $logFile, $Calibration, $secretFile, $Model)) {
    if ($p -and ($p -match "[`r`n]")) { throw "Refusing to generate a wrapper: a path contains a newline ($p)." }
}
$pctPython = $python -replace '%', '%%'
$pctRoot = $root -replace '%', '%%'
$pctConfig = $ConfigPath -replace '%', '%%'
$pctLog = $logFile -replace '%', '%%'
$pctSecret = $secretFile -replace '%', '%%'
$calArg = if ($Calibration) { ' --calibration "' + ($Calibration -replace '%', '%%') + '"' } else { '' }
$modelArg = if ($Model) { ' --model "' + ($Model -replace '%', '%%') + '" --device "' + $Device + '"' } else { '' }

# One helper per shape so the wrapper line stays readable and every value is %-escaped:
# a literal % in a .cmd file is an expansion, and a path containing one would be silently
# mangled into something else.
function _Arg([string]$flag, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return '' }
    return ' ' + $flag + ' "' + ($value -replace '%', '%%') + '"'
}
$sceneArg      = (_Arg '--scene-atlas' $SceneAtlas) + (_Arg '--scene' $Scene)
$channelArg    = if ($Channel -ge 0) { " --channel $Channel" } else { '' }
$episodeArg    = _Arg '--hard-case-episodes' $HardCaseEpisodes
$hardCaseArg   = if ($HardCases) { (_Arg '--hard-cases' $HardCases) + " --hard-case-max-gb $HardCaseMaxGb" + $episodeArg } else { '' }
$relocateArg   = " --relocate-seconds $RelocateSeconds"
$shadowArg     = (_Arg '--shadow-ledger' $ShadowLedger) + (_Arg '--challenger-model' $ChallengerModel)
$adjArg        = (_Arg '--adjudicator-model' $AdjudicatorModel) + (_Arg '--adjudicator-device' $AdjudicatorDevice)
$evidenceArg   = _Arg '--evidence' $Evidence
$ledgerArg     = _Arg '--ledger' $Ledger
$replayArg     = if ($Replay) { ' --replay' } else { '' }
$noCropArg     = if ($NoCrop) { ' --no-crop' } else { '' }
$captureArg    = (_Arg '--source' $Source) + (_Arg '--window-title' $WindowTitle) + $noCropArg
$modeArg       = (_Arg '--mode' $Mode) + (_Arg '--commissioning-run' $CommissioningRun)
# -1 is the "operator said nothing" sentinel; 0 is a real, meaningful value for both of
# these (drain nothing / persist every frame), so an `if ($X)` truthiness test would
# silently discard a deliberate zero.
$drainArg      = if ($DrainSeconds   -ge 0) { " --drain-seconds $DrainSeconds" }   else { '' }
$persistArg    = if ($PersistSeconds -ge 0) { " --persist-seconds $PersistSeconds" } else { '' }
# --dry-run gates the StateNour lane ONLY; the shop lane still POSTs. Its own help text
# says so. Do not read an installed --dry-run as "this task writes nothing".
$dryRunArg     = if ($ProducerDryRun) { ' --dry-run' } else { '' }
$logLevelArg   = _Arg '--log-level' $LogLevel
$extraArg      = if ($ExtraArgs) { ' ' + $ExtraArgs } else { '' }

# The secret is decrypted by a short inline PowerShell call and handed to the child as an
# environment variable. It never appears on a command line (Task Manager shows those) and
# never reaches the log.
$secretLine = if (Test-Path $secretFile) {
    'for /f "usebackq delims=" %%K in (`powershell -NoProfile -Command "$s=Import-Clixml -Path ''' + $pctSecret + '''; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "CAMERA_INGEST_KEY=%%K"'
} else { 'rem no encrypted secret installed; the shop lane will stay unconfigured' }

$wrapperBody = @"
@echo off
setlocal
cd /d "$pctRoot"
$secretLine
echo. >> "$pctLog"
echo ==== edge start %DATE% %TIME% ==== >> "$pctLog"
"$pctPython" edge_main.py --config "$pctConfig" --camera "$Camera"$calArg$modelArg$sceneArg$channelArg$hardCaseArg$relocateArg$shadowArg$adjArg$evidenceArg$ledgerArg$replayArg$captureArg$modeArg$drainArg$persistArg$dryRunArg$logLevelArg$extraArg --fps $Fps --heartbeat-seconds $HeartbeatSeconds --stall-exit-seconds $StallExitSeconds >> "$pctLog" 2>&1
set RC=%ERRORLEVEL%
echo ==== edge exit %RC% %DATE% %TIME% ==== >> "$pctLog"
exit /b %RC%
"@

if ($DryRun) {
    Write-Host "DRY RUN -- the wrapper that WOULD be written to $wrapper" -ForegroundColor Cyan
    Write-Host $wrapperBody
    Write-Host "Task: '$TaskName' AtLogOn as $env:USERDOMAIN\$env:USERNAME, restart every 1 min, up to 999 times."
    exit 0
}

Set-Content -Path $wrapper -Value $wrapperBody -Encoding ASCII

# --- Task --------------------------------------------------------------------
$action = New-ScheduledTaskAction -Execute $wrapper -WorkingDirectory $root
# StartWhenAvailable so a machine that was asleep at the trigger still starts; battery
# flags so a laptop on the shop counter does not silently stop watching the lot;
# IgnoreNew so a manual run cannot end up with two producers on one camera, which would
# double every heartbeat sequence and fight over the ledger.
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
$user = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
# Interactive / Limited, NOT ServiceAccount: WGC needs this user's desktop session.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
} catch {
    throw "Register-ScheduledTask failed: $($_.Exception.Message)"
}

Write-Host "Registered '$TaskName'." -ForegroundColor Green
Write-Step "runs at logon as $user (WGC needs an interactive desktop; SYSTEM would stall in Session 0)"
Write-Step "OS restarts a dead process every 1 min; the process exits 3 itself after ${StallExitSeconds}s with no frame"
Write-Step ("detector: " + $(if ($Model) { "$Model on $Device" } else { "MOTION-ONLY -- no arrival can be confirmed" }))
Write-Step "log: $logFile"
Write-Step "start it now:  Start-ScheduledTask -TaskName $TaskName"
Write-Step "check it:      powershell -File scripts/doctor-edge-runtime.ps1"
