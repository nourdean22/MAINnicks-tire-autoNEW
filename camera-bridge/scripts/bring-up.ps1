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
    $out = & python (Join-Path $PSScriptRoot "locate_scene.py") $scene 2>&1 | Select-Object -Last 1
    if ($out -match "^FOUND") {
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
    $state = (Get-ScheduledTask -TaskName $task -ErrorAction SilentlyContinue).State
    if ($state -ne "Running") { Step "bound $task" "FAIL" "task is $state after start"; continue }
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
