<#
.SYNOPSIS
    Bring the whole lot-watching stack up, and REFUSE rather than half-start it.
.DESCRIPTION
    One command instead of a remembered sequence: start the V380 client, wait for a window
    that actually renders, prove each producer's scene can be located in it, then start the
    scheduled tasks and confirm each one bound to the camera it was installed for.

    WHY A SCRIPT AND NOT A CHECKLIST. Every step here is one somebody got wrong by hand on
    2026-09-10:

      * The producer was started while the V380 window was showing a different channel
        arrangement, so `--scene shop-left` could not bind at all and the producer sat
        retrying against a layout that did not contain its camera.
      * A second producer was installed and both tasks pointed at one wrapper file, so the
        task installed for the LEFT lens started the RIGHT camera. Both read `Running`.
      * The producers were killed by a console close and nothing restarted them; the lot went
        unwatched for ten hours while both tasks read `Ready`, which is not an error state.

    So this verifies BEFORE starting and AFTER starting, and says which step failed and what
    to do about it. It is safe to run repeatedly: every step is idempotent, and a producer
    that is already running is left alone rather than restarted.

    It does NOT drive the V380 UI. The app remembers its own layout, and clicking through a
    native app's chrome is the most fragile thing that could possibly sit under the lot's
    geometry. If the layout is wrong this refuses and says so, which is a problem a person
    fixes in five seconds and a script gets wrong silently.
.PARAMETER Cameras
    Task name -> scene id. Defaults to the two installed producers.
.PARAMETER SkipStart
    Run every check and report, but start nothing. Use before trusting a change.
.EXAMPLE
    powershell -File scripts/bring-up.ps1
    powershell -File scripts/bring-up.ps1 -SkipStart
#>
[CmdletBinding()]
param(
    [hashtable]$Cameras = @{ "NickEdgeProducer" = "shop-left"; "NickEdgeProducerRight" = "shop-right" },
    [switch]$SkipStart,
    [int]$WindowTimeoutSeconds = 90
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$failed = 0

function Step {
    param([string]$Name, [string]$Status, [string]$Detail)
    $colour = switch ($Status) { "PASS" { "Green" } "WARN" { "Yellow" } default { "Red" } }
    Write-Host ("  {0,-5} {1,-26} {2}" -f $Status, $Name, $Detail) -ForegroundColor $colour
    if ($Status -eq "FAIL") { $script:failed++ }
}

# THE TASK STATE IS NOT THE PRODUCER'S STATE, and believing it cost a full day on 2026-09-17.
#
# Task Scheduler kills the WRAPPER (cmd.exe) but the python child SURVIVES, orphaned. Measured:
# `ppid 26160 is GONE` while that producer kept heartbeating every 30s for two hours on one
# unbroken instance id, no `==== edge exit ====` banner ever written because the wrapper died
# before it could. `Get-ScheduledTask` read `Ready` the whole time and `LastTaskResult` was
# 0xC000013A (STATUS_CONTROL_C_EXIT) -- the wrapper's death, not the producer's.
#
# Two different wrong answers came out of trusting that:
#   * step 5 reported `FAIL bound ... task is Ready after start` while the lot was being watched
#     perfectly -- a false alarm that sent three separate debugging sessions chasing nothing.
#   * step 4 read `Ready` and STARTED A SECOND PRODUCER on a lens that already had one, both
#     writing the same ledger and fighting over the metrics port.
#
# So ask the OS what is running, keyed on the scene the producer was told to watch. The command
# line is the only thing that distinguishes two producers of the same executable.
function Get-ProducerProcess {
    param([string]$SceneId)
    Get-CimInstance Win32_Process -Filter "Name like '%python%'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -and $_.CommandLine -match 'edge_main' -and
                       $_.CommandLine -match ('--scene\s+"?' + [regex]::Escape($SceneId) + '"?(\s|$)') } |
        Select-Object -First 1
}

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " Nick's Tire - lot producer bring-up"      -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# --- 1. the V380 client ------------------------------------------------------------------
$v380 = Get-Process -Name V380 -ErrorAction SilentlyContinue
if (-not $v380) {
    $exe = "C:\Program Files (x86)\V380\V380.exe"
    if (-not (Test-Path $exe)) {
        Step "V380 client" "FAIL" "not running and not installed at $exe"
    } else {
        Start-Process -FilePath $exe | Out-Null
        Step "V380 client" "PASS" "was not running; started it"
    }
} else {
    Step "V380 client" "PASS" "already running (pid $($v380.Id))"
}

# --- 2. a window that actually RENDERS ----------------------------------------------------
# "A window titled V380 exists" and "the producer can see a camera" are different claims, and
# the doctor used to make only the first -- it passed for hours against a menu pane. This
# waits for the second.
$deadline = (Get-Date).AddSeconds($WindowTimeoutSeconds)
$probe = $null
do {
    $probe = & python (Join-Path $PSScriptRoot "probe_capture.py") 2>&1 | Select-Object -Last 1
    if ($probe -match "status=live") { break }
    Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

if ($probe -match "status=live") {
    Step "capture is LIVE" "PASS" ($probe -replace ".*(fps=[0-9.]+).*", '$1')
} else {
    Step "capture is LIVE" "FAIL" "no usable frames within ${WindowTimeoutSeconds}s -- $probe"
}

# --- 3. can each producer's scene actually be located in THIS layout? ---------------------
# The step that would have caught the wasted restart: the app came back on a different channel
# arrangement and `shop-left` was not on screen at all.
$locatable = @{}
foreach ($task in ($Cameras.Keys | Sort-Object)) {
    $scene = $Cameras[$task]
    # READ THE VERDICT, NOT THE LAST LINE. `locate_scene.py` prints its answer and then tears
    # down the WGC capture thread, which on this box intermittently dies in interpreter
    # shutdown with `Fatal Python error: gilstate_tss_set: failed to set current tstate (TSS)`.
    # The measurement already succeeded -- observed printing `FOUND 778x440 ... inliers=70` and
    # THEN crashing -- but a last-line read returns the crash text and this step reported a
    # perfectly locatable camera as FAIL, which then withheld a producer that would have run.
    # A crash after the verdict is a teardown bug, not a locate failure; scan for the verdict.
    $lines = & python (Join-Path $PSScriptRoot "locate_scene.py") $scene 2>&1
    $verdict = $lines | Where-Object { $_ -match "^FOUND" } | Select-Object -First 1
    $out = if ($verdict) { $verdict } else { $lines | Select-Object -Last 1 }
    if ($verdict) {
        $locatable[$task] = $true
        Step "scene $scene" "PASS" $out
    } else {
        $locatable[$task] = $false
        Step "scene $scene" "FAIL" "$out -- set the V380 window back to the layout this camera was calibrated in"
    }
}

# --- 4. start only what can bind ----------------------------------------------------------
foreach ($task in ($Cameras.Keys | Sort-Object)) {
    $t = Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue
    if (-not $t) { Step "task $task" "FAIL" "not registered -- run scripts/install-edge-runtime.ps1"; continue }
    # The PROCESS, not the task state -- see Get-ProducerProcess. Starting on top of an orphan
    # gives one lens two producers sharing a ledger, which is worse than not starting at all.
    $existing = Get-ProducerProcess -SceneId $Cameras[$task]
    if ($existing) { Step "task $task" "PASS" "producer pid $($existing.ProcessId) already watching $($Cameras[$task]); left alone"; continue }
    if ($t.State -eq "Running") { Step "task $task" "PASS" "already running; left alone"; continue }
    if (-not $locatable[$task]) { Step "task $task" "WARN" "not started: its scene is not on screen"; continue }
    if ($SkipStart) { Step "task $task" "WARN" "-SkipStart: would have started it"; continue }
    Start-ScheduledTask -TaskName $task
    Step "task $task" "PASS" "started"
}

if ($SkipStart) {
    Write-Host ""
    Write-Host "-SkipStart: nothing was started." -ForegroundColor Yellow
    exit ($(if ($failed) { 1 } else { 0 }))
}

# --- 5. confirm each one bound to the camera it was INSTALLED for -------------------------
# Not "is it running" -- it ran perfectly well pointed at the wrong lens once. This reads the
# scene the producer itself reports having located, from its own log, after it started.
Start-Sleep -Seconds 45
foreach ($task in ($Cameras.Keys | Sort-Object)) {
    $suffix = if ($task -eq "NickEdgeProducer") { "" } else { "-$task" }
    $log = Join-Path $root "logs\edge$suffix.log"
    $proc = Get-ProducerProcess -SceneId $Cameras[$task]
    $state = (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State
    if (-not $proc) { Step "bound $task" "FAIL" "no producer process for $($Cameras[$task]) (task reads $state)"; continue }
    # An orphaned producer is WATCHING THE LOT, which is the thing this script exists to confirm.
    # Report the detachment so it is visible and fixable, but never call a working lot a failure.
    if ($state -ne "Running") {
        Step "task $task" "WARN" "producer pid $($proc.ProcessId) is alive but DETACHED from the task (task reads $state); it will not be restarted automatically"
    }
    if (-not (Test-Path $log)) { Step "bound $task" "FAIL" "no log at $log"; continue }
    $line = Select-String -Path $log -Pattern "scene located: scene=(\S+)" | Select-Object -Last 1
    if (-not $line) { Step "bound $task" "FAIL" "started but has not located a scene yet"; continue }
    $found = [regex]::Match($line.Line, "scene=(\S+)").Groups[1].Value
    if ($found -eq $Cameras[$task]) {
        Step "bound $task" "PASS" "$found"
    } else {
        Step "bound $task" "FAIL" "bound $found but was installed for $($Cameras[$task]) -- STOP IT; it is watching the wrong lens"
    }
}

Write-Host ""
if ($failed) {
    Write-Host "$failed step(s) FAILED -- the lot is not fully watched." -ForegroundColor Red
    exit 1
}
Write-Host "All producers up and bound to the cameras they were installed for." -ForegroundColor Green
exit 0
