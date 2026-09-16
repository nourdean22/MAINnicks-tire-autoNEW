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

    THE SECRET IS NEVER STORED IN PLAINTEXT NEXT TO THE CODE. `-EncryptSecret` writes a DPAPI
    blob (secrets/camera-ingest.xml) that only THIS user on THIS machine can decrypt. The
    generated wrapper decrypts it into the child process's environment at start, so the key
    never reaches a command line (visible in Task Manager) or a log.

    TWO SOURCES FOR THAT SECRET, and the second exists because the first one dead-ends.
      * `.env.local` (default) -- for a box where the operator already has the file.
      * `-SecretFromEnvironment` -- reads $env:CAMERA_INGEST_KEY, which is what
        `railway run` injects. This is the ONLY route onto a fresh machine that does not
        route a live credential through a human: the Railway MCP returns names with
        `valuesRedacted: true`, and agents are barred from authoring `.env` files, so
        "put the key in .env.local first" is an instruction nobody in the loop can carry
        out. It stalled the shop PC's producer for days. Railway's CLI *can* read the
        value, so the key goes Railway -> process env -> DPAPI blob and is never written
        anywhere in plaintext.

    DPAPI IS PER-USER PER-MACHINE, so the blob cannot be built on one box and copied to
    another. Every machine runs its own encryption; that is the point, not a limitation.
.EXAMPLE
    powershell -File scripts/install-edge-runtime.ps1 -EncryptSecret
    railway run --service MAINnicks-tire-auto -- pwsh -NoProfile -File scripts/install-edge-runtime.ps1 -SecretFromEnvironment -SecretOnly
    powershell -File scripts/install-edge-runtime.ps1 -Calibration .\scratchpad\shopsign_calibration.json
    powershell -File scripts/install-edge-runtime.ps1 -DryRun
    powershell -File scripts/install-edge-runtime.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$DryRun,
    [switch]$EncryptSecret,
    # Implies -EncryptSecret. There is no other thing this switch could mean, and a run that
    # silently encrypted nothing because the operator passed one switch instead of two is
    # exactly the "looks fine, did nothing" outcome this installer exists to prevent.
    [switch]$SecretFromEnvironment,
    # Encrypt the secret and STOP, leaving the registered task exactly as it is.
    #
    # Without this, -EncryptSecret falls through into the registration below and regenerates
    # the wrapper from whatever flags THIS invocation carried -- i.e. the defaults. A box
    # whose producer was installed with --scene/--channel/--calibration would silently have
    # all of them dropped by someone who only meant to install a key, and the task would
    # still read Running while watching the wrong thing. Installing a credential and
    # reconfiguring a producer are different jobs; this switch lets you ask for only the first.
    [switch]$SecretOnly,
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
    [string]$Trajectories = "",
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
# PER TASK, not per checkout. `-TaskName` was already a parameter -- so a second producer
# for a second lens registered happily and then OVERWROTE the first one's wrapper, because
# the wrapper path was a constant. Both tasks pointed at one file, so the surviving content
# won: the "left" task would have started the RIGHT camera at its next restart, and the lens
# it was installed for would have gone unwatched with two tasks Running and nothing red.
# Caught by installing a real second producer, not by a test.
#
# The DEFAULT name is unchanged, so an existing single-producer box keeps the exact paths it
# already has and nothing needs migrating.
$taskSlug = ($TaskName -replace '[^A-Za-z0-9._-]', '_')
$suffix = if ($taskSlug -eq 'NickEdgeProducer') { '' } else { "-$taskSlug" }
$logFile = Join-Path $logDir "edge$suffix.log"
$wrapper = Join-Path $root "edge-task$suffix.cmd"
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

# --- Secret: encrypt once, from a file or from the injected environment -------
if ($SecretFromEnvironment) { $EncryptSecret = $true }
if ($EncryptSecret) {
    if ($SecretFromEnvironment) {
        $value = $env:CAMERA_INGEST_KEY
        # NAME THE WRAPPER IN THE FAILURE, AND MAKE THE PRINTED COMMAND THE ONE THAT WORKS.
        # Run bare, this variable is simply absent, and "CAMERA_INGEST_KEY is not set" sends
        # the reader hunting for a file that is not the mechanism. The fix is almost always
        # the missing `railway run` prefix.
        #
        # `pwsh`, NOT `powershell`, and only here. Invoked directly, Windows PowerShell 5.1
        # runs this script fine. Invoked as `railway run -- powershell ...` it dies with
        # "the module could not be loaded" on Microsoft.PowerShell.Security, so
        # ConvertTo-SecureString does not resolve -- the CLI hands its child a different
        # environment than the shell you typed in. An error message that prints the failing
        # command is worse than no example: it is the string the reader will copy.
        if (-not $value) {
            throw ("CAMERA_INGEST_KEY is not in this process's environment. -SecretFromEnvironment " +
                   "expects a wrapper that injects it, e.g.`n" +
                   "  railway run --service MAINnicks-tire-auto -- pwsh -NoProfile -File scripts/install-edge-runtime.ps1 -SecretFromEnvironment -SecretOnly`n" +
                   # No backticks around the command. In a double-quoted PowerShell string a
                   # backtick is the ESCAPE character, so "`railway" renders as a carriage
                   # return followed by "ailway" -- this line printed "Check ailway whoami
                   # first" on the shop PC. An error whose job is to hand the reader a
                   # command they will copy cannot afford to mangle it, which is the same
                   # defect class as printing `powershell` where only `pwsh` works.
                   "Check 'railway whoami' first; the CLI must be logged in ON THIS MACHINE.")
        }
        $sourceLabel = "the injected environment (nothing was written in plaintext)"
    } else {
        $envFile = Join-Path $root ".env.local"
        if (-not (Test-Path $envFile)) {
            throw ("$envFile not found. Either create it with a CAMERA_INGEST_KEY=... line, or skip the " +
                   "file entirely and pull the key straight from Railway with -SecretFromEnvironment.")
        }
        $line = Select-String -Path $envFile -Pattern '^CAMERA_INGEST_KEY=' | Select-Object -First 1
        if (-not $line) { throw "$envFile has no CAMERA_INGEST_KEY= line." }
        $value = ($line.Line -split '=', 2)[1].Trim()
        if (-not $value) { throw "CAMERA_INGEST_KEY in $envFile is empty." }
        $sourceLabel = $envFile
    }
    if (-not (Test-Path $secretDir)) { New-Item -ItemType Directory -Path $secretDir | Out-Null }
    # DPAPI: ConvertTo-SecureString + Export-Clixml ties the blob to this user AND this
    # machine. Copying the file to another box, or reading it as another user, fails.
    ConvertTo-SecureString -String $value -AsPlainText -Force | Export-Clixml -Path $secretFile

    # A FINGERPRINT, NEVER THE VALUE. Two boxes must carry the SAME key or one of them posts
    # 401s forever, and "did the right secret land?" is otherwise only answerable by printing
    # it. A truncated SHA-256 answers it without ever putting the key on a screen or in a log.
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fp = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-', '').Substring(0, 12).ToLower()
    $sha.Dispose()
    Write-Host "Secret encrypted to $secretFile (DPAPI: this user, this machine)." -ForegroundColor Green
    Write-Host "  source:      $sourceLabel" -ForegroundColor Gray
    Write-Host "  fingerprint: sha256:$fp  (len $($value.Length)) -- compare across boxes; never the key itself." -ForegroundColor Gray
    if (-not $SecretFromEnvironment) {
        Write-Host "You can now delete the plaintext CAMERA_INGEST_KEY line from .env.local if you want." -ForegroundColor Yellow
    }
    if ($SecretOnly) {
        Write-Host "-SecretOnly: the registered task was left untouched. Restart it to pick the key up." -ForegroundColor Yellow
        exit 0
    }
}
# A run that encrypts nothing and installs nothing has done NO work, and printing the plan as
# if it had is how a no-op gets read as a success.
if ($SecretOnly -and -not $EncryptSecret) {
    throw "-SecretOnly needs a secret to install: add -SecretFromEnvironment, or -EncryptSecret to read .env.local."
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
$trajArg       = _Arg '--trajectories' $Trajectories
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
"$pctPython" edge_main.py --config "$pctConfig" --camera "$Camera"$calArg$modelArg$sceneArg$channelArg$hardCaseArg$relocateArg$shadowArg$adjArg$evidenceArg$ledgerArg$replayArg$trajArg$captureArg$modeArg$drainArg$persistArg$dryRunArg$logLevelArg$extraArg --fps $Fps --heartbeat-seconds $HeartbeatSeconds --stall-exit-seconds $StallExitSeconds >> "$pctLog" 2>&1
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
# TWO TRIGGERS, and the second is the one that matters.
#
# At-logon alone leaves a gap that was not theoretical: on 2026-09-10 both producers exited
# with 0xC000013A (STATUS_CONTROL_C_EXIT) when the console session they were started from
# closed, and `RestartCount` did NOT recover them -- Task Scheduler does not treat that exit
# as the kind of failure a restart policy is for. They stayed `Ready`, `NumberOfMissedRuns=0`,
# and the lot went unwatched for TEN HOURS with nothing red anywhere, because a stopped task
# is not an error state.
#
# A repeating trigger closes it without another process to supervise. `MultipleInstances
# IgnoreNew` is what makes it safe to fire every few minutes: if the producer is already
# running the new start is DROPPED, so this can only ever resurrect a dead one, never mint a
# second producer on the same camera.
$trigger = @(
    New-ScheduledTaskTrigger -AtLogOn -User $user
    # -RepetitionDuration IS REQUIRED, and its absence fails silently. Without it the
    # registered trigger comes back with Interval=PT5M and an EMPTY Duration plus
    # StopAtDurationEnd=True -- a repetition of zero length, so it fires once at most and
    # never repeats. Measured: the task sat `Ready` through the whole window it was supposed
    # to self-heal in, and `Get-ScheduledTask` reports the interval either way, so the
    # trigger LOOKS correct in every listing.
    # [TimeSpan]::MaxValue is not usable either -- it serialises to P99999999DT23H59M59S and
    # Set-ScheduledTask rejects it as out of range. 3650 days is the longest span that
    # registers cleanly.
    $heal = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(2) `
        -RepetitionInterval (New-TimeSpan -Minutes 5) `
        -RepetitionDuration (New-TimeSpan -Days 3650)
    $heal
)
# Interactive / Limited, NOT ServiceAccount: WGC needs this user's desktop session.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited

try {
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
} catch {
    throw "Register-ScheduledTask failed: $($_.Exception.Message)"
}

Write-Host "Registered '$TaskName'." -ForegroundColor Green
Write-Step "runs at logon as $user (WGC needs an interactive desktop; SYSTEM would stall in Session 0)"
Write-Step "self-heals: a repeating 5-min trigger restarts it if it is not running; IgnoreNew makes that a no-op when it is"
Write-Step "OS restarts a dead process every 1 min; the process exits 3 itself after ${StallExitSeconds}s with no frame"
Write-Step ("detector: " + $(if ($Model) { "$Model on $Device" } else { "MOTION-ONLY -- no arrival can be confirmed" }))
Write-Step "log: $logFile"
Write-Step "start it now:  Start-ScheduledTask -TaskName $TaskName"
Write-Step "check it:      powershell -File scripts/doctor-edge-runtime.ps1"
