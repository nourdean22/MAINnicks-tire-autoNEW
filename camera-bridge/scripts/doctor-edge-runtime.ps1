<#
.SYNOPSIS
    Preflight for the durable edge runtime. Run it BEFORE driving to the shop.
.DESCRIPTION
    Every check answers one question the operator would otherwise answer by watching the
    lot for ten minutes and guessing. Each prints PASS / WARN / FAIL with the reason, and
    the exit code is the number of FAILs -- so this is usable in a script, not only by eye.

    WARN vs FAIL is a real distinction, not politeness. FAIL means the producer cannot do
    its job at all. WARN means it will run and tell the truth about being limited: no
    calibration is a WARN because census mode is a legitimate, honest state that reports
    itself as CALIBRATION_INVALID rather than pretending to be healthy.
.EXAMPLE
    powershell -File scripts/doctor-edge-runtime.ps1
    powershell -File scripts/doctor-edge-runtime.ps1 -Calibration .\scratchpad\shopsign_calibration.json
#>
[CmdletBinding()]
param(
    [string]$TaskName = "NickEdgeProducer",
    [string]$ConfigPath = "",
    [string]$Calibration = "",
    [string]$Model = "",
    [string]$Camera = "sign",
    [string]$WindowTitle = "V380"
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
if (-not $ConfigPath) { $ConfigPath = Join-Path $root "config.yaml" }
$fails = 0
$warns = 0

function Check($name, $state, $detail) {
    $colour = switch ($state) { "PASS" { "Green" } "WARN" { "Yellow" } default { "Red" } }
    $pad = $name.PadRight(26)
    Write-Host ("  {0} {1}  {2}" -f $pad, $state.PadRight(4), $detail) -ForegroundColor $colour
    if ($state -eq "FAIL") { $script:fails++ }
    if ($state -eq "WARN") { $script:warns++ }
}

Write-Host ""
Write-Host "Nick Edge -- preflight" -ForegroundColor Cyan
Write-Host ""

# --- Runtime ----------------------------------------------------------------
$py = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $py) { Check "python" "FAIL" "not on PATH" } else {
    $v = (& $py.Source -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
    if ([version]$v -lt [version]"3.12") { Check "python" "FAIL" "$v at $($py.Source) -- needs 3.12+" }
    else { Check "python" "PASS" "$v at $($py.Source)" }
}

if ($py) {
    # windows_capture is the WGC lane and the ONLY pixel source proven against these
    # cameras. Its absence is a FAIL, not a warning: without it the producer falls through
    # to the mss window lane, which was demoted for capturing whatever overlaps the window.
    $wc = (& $py.Source -c "import windows_capture; print('ok')" 2>&1)
    if ($wc -match "ok") { Check "windows_capture" "PASS" "importable (the WGC lane)" }
    else { Check "windows_capture" "FAIL" "not importable -- pip install windows-capture" }

    # FAIL, not WARN. A box can hold a perfectly good XML/BIN pair and still have no
    # runtime to execute it: `build_council` catches the unavailable detector and runs
    # motion-only, where `can_confirm_arrival` is ALWAYS false. With a calibration present
    # the health lattice then reports the producer HEALTHY while it records no arrival,
    # ever -- a green light over a camera that cannot do its job, which is the precise
    # false-green this doctor exists to prevent (Codex P1 on #2255). Witnessed on this
    # machine 2026-09-09: weights on disk, runtime absent, doctor exited 0.
    $ov = (& $py.Source -c "import openvino; print(openvino.__version__)" 2>&1)
    if ($ov -match "^\d") { Check "openvino" "PASS" "$ov" }
    else { Check "openvino" "FAIL" "not importable -- pip install openvino. The council degrades to MOTION-ONLY and can NEVER confirm an arrival" }

    $np = (& $py.Source -c "import numpy, cv2; print('ok')" 2>&1)
    if ($np -match "ok") { Check "numpy + cv2" "PASS" "importable" }
    else { Check "numpy + cv2" "FAIL" "missing -- pip install numpy opencv-python-headless" }
}

# --- Config and calibration -------------------------------------------------
if (-not (Test-Path $ConfigPath)) {
    Check "config.yaml" "FAIL" "$ConfigPath not found -- cp config.example.yaml config.yaml"
} else {
    $cfg = Get-Content $ConfigPath -Raw
    Check "config.yaml" "PASS" $ConfigPath
    # The AUTHORITATIVE lane. Without this key CloudClient.deliver_once() returns
    # 'blocked' on every row and the StateNour outbox never drains -- silently, because a
    # blocked row is retried rather than failed. edge_main now load_dotenv()s so a .env in
    # this directory is enough (Codex P1 on #2255, round 8).
    # CHECK WHAT THE SCHEDULED TASK WILL SEE, not what this shell inherited.
    #
    # The task runs AtLogOn and therefore gets a FRESH environment including User- and
    # Machine-scope variables. A doctor that read only $env: would report WARN forever on a
    # machine where the key was set after the current shell started -- a false negative,
    # and exactly as misleading as the false green this check was added to prevent.
    # Persisted scopes are read from the registry via [Environment], which is what a new
    # process actually inherits.
    $stSource = if ($env:STATENOUR_SYNC_KEY) { "process env" }
        elseif ([Environment]::GetEnvironmentVariable("STATENOUR_SYNC_KEY", "User")) { "User scope (the scheduled task inherits this)" }
        elseif ([Environment]::GetEnvironmentVariable("STATENOUR_SYNC_KEY", "Machine")) { "Machine scope" }
        elseif ((Test-Path (Join-Path $root ".env")) -and
                (Select-String -Path (Join-Path $root ".env") -Pattern "^\s*STATENOUR_SYNC_KEY\s*=\s*\S" -Quiet)) { ".env (loaded by edge_main)" }
        else { $null }
    if ($stSource) { Check "STATENOUR_SYNC_KEY" "PASS" "resolvable via $stSource" }
    else { Check "STATENOUR_SYNC_KEY" "WARN" "not set -- the AUTHORITATIVE outbox will queue forever and never drain" }
    if ($cfg -match "(?m)^\s*shopUrl:\s*\S") { Check "backend.shopUrl" "PASS" "set" }
    else { Check "backend.shopUrl" "WARN" "not set -- visits persist locally but the shop admin never updates" }
    if ($cfg -match "(?m)^\s{2}$([regex]::Escape($Camera)):") { Check "cameras.$Camera" "PASS" "declared" }
    else { Check "cameras.$Camera" "FAIL" "not in the config -- the shop's registry keys on this exact name" }
}

if ($Calibration) {
    if (Test-Path $Calibration) {
        try {
            $cal = Get-Content $Calibration -Raw | ConvertFrom-Json
            $lot = @($cal.lot).Count
            $portal = @($cal.portal).Count
            if ($lot -ge 3 -and $portal -ge 3) { Check "calibration" "PASS" "lot $lot pts, portal $portal pts" }
            elseif ($lot -ge 3) { Check "calibration" "WARN" "lot present but NO portal -- arrivals cannot be claimed" }
            else { Check "calibration" "FAIL" "no usable lot polygon" }
        } catch { Check "calibration" "FAIL" "not valid JSON: $($_.Exception.Message)" }
    } else { Check "calibration" "FAIL" "$Calibration not found" }
} else {
    Check "calibration" "WARN" "none given -- CENSUS MODE: occupancy and health only, no arrival claimed"
}

# --- Detector ---------------------------------------------------------------
# A FAIL, not a warning, and deliberately harsher than the openvino check above: a missing
# runtime is loud, whereas a missing MODEL fails silently. `can_confirm_arrival` stays
# False, every candidate is rejected, and the producer runs for weeks looking healthy while
# recording nothing at all.
if (-not $Model -and $env:VISION_OV_MODEL) { $Model = $env:VISION_OV_MODEL }
if (-not $Model) {
    $guess = Join-Path $root "ov_models\vehicle-detection-0200\FP16\vehicle-detection-0200.xml"
    if (Test-Path $guess) { $Model = $guess }
}
if (-not $Model) {
    Check "detector model" "FAIL" "none found -- MOTION-ONLY, no arrival can ever be confirmed. Run: python -m vision.fetch_models --dest ov_models"
} elseif (-not (Test-Path $Model)) {
    Check "detector model" "FAIL" "$Model does not exist"
} else {
    $bin = [IO.Path]::ChangeExtension($Model, ".bin")
    if (Test-Path $bin) {
        $mb = [math]::Round((Get-Item $bin).Length / 1MB, 1)
        Check "detector model" "PASS" "$([IO.Path]::GetFileName($Model)) (+ $mb MB weights)"
    } else {
        # An .xml without its .bin loads as an empty graph -- the exact silent-failure
        # shape this check exists for.
        Check "detector model" "FAIL" "$Model has no matching .bin beside it"
    }
}

# --- Secret -----------------------------------------------------------------
$secretFile = Join-Path $root "secrets\camera-ingest.xml"
if (Test-Path $secretFile) {
    try {
        $s = Import-Clixml -Path $secretFile
        $len = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)).Length
        Check "ingest secret" "PASS" "DPAPI blob decrypts as this user ($len chars)"
    } catch {
        # The most likely cause by far, and the one worth naming: the blob was created by
        # another user or on another machine, which is DPAPI working correctly.
        Check "ingest secret" "FAIL" "present but will not decrypt as this user -- re-run install with -EncryptSecret"
    }
} elseif (Test-Path (Join-Path $root ".env.local")) {
    Check "ingest secret" "WARN" "plaintext .env.local only -- run install-edge-runtime.ps1 -EncryptSecret"
} else {
    Check "ingest secret" "WARN" "none -- the shop lane stays unconfigured and the admin will not update"
}

# --- Capture target ---------------------------------------------------------
$win = Get-Process | Where-Object { $_.MainWindowTitle -like "*$WindowTitle*" } | Select-Object -First 1
if ($win) { Check "capture window" "PASS" "'$($win.MainWindowTitle)' (pid $($win.Id)) -- minimised is fine, the producer restores it" }
else { Check "capture window" "FAIL" "no window matching '$WindowTitle' -- open the camera app and its live view" }

# --- Disk and ledger --------------------------------------------------------
$drive = (Get-Item $root).PSDrive
$freeGb = [math]::Round($drive.Free / 1GB, 1)
if ($freeGb -lt 2) { Check "disk" "FAIL" "$freeGb GB free -- the ledger and evidence need room" }
elseif ($freeGb -lt 10) { Check "disk" "WARN" "$freeGb GB free" }
else { Check "disk" "PASS" "$freeGb GB free" }

# PER CAMERA, matching edge_main.camera_ledger_path. Two camera processes sharing one
# SQLite file overwrite each other's tracker state on every commit, so each gets its own;
# a doctor that reported the unscoped path would be describing a file the producer will
# never open (Codex P1 on #2255, round 8).
$ledger = Join-Path $root ("data\edge-" + $Camera + ".sqlite")
$legacy = Join-Path $root "data\edge.sqlite"
if (Test-Path $ledger) {
    $sizeMb = [math]::Round((Get-Item $ledger).Length / 1MB, 1)
    Check "ledger" "PASS" "$ledger ($sizeMb MB) -- open visits will be restored on start"
} elseif (Test-Path $legacy) {
    Check "ledger" "WARN" "none for '$Camera' yet; a pre-split $legacy exists and is NO LONGER READ -- its open visits will not be restored"
} else { Check "ledger" "PASS" "none yet; it is created on first run" }

# --- Supervision ------------------------------------------------------------
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Check "scheduled task" "WARN" "'$TaskName' not registered -- run install-edge-runtime.ps1"
} else {
    $info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $principal = $task.Principal.LogonType
    if ($principal -eq "ServiceAccount") {
        # Worth a FAIL: it would look healthy in Task Scheduler and capture nothing,
        # because Session 0 has no desktop for WGC to read.
        Check "scheduled task" "FAIL" "'$TaskName' runs as a service account -- WGC needs an interactive desktop"
    } else {
        $last = if ($info) { "last run $($info.LastRunTime), result $($info.LastTaskResult)" } else { "never run" }
        Check "scheduled task" "PASS" "'$TaskName' ($($task.State)), $last"
    }
}

# --- Cloud reachability -----------------------------------------------------
try {
    $r = Invoke-WebRequest -Uri "https://nickstire.org/api/health" -TimeoutSec 15 -UseBasicParsing
    $body = $r.Content | ConvertFrom-Json
    Check "shop reachable" "PASS" "healthy, deploy $($body.deploy.commitShort)"
} catch {
    # WARN, not FAIL: the whole point of the durable outbox is that the producer keeps
    # sensing and queues while the shop is unreachable.
    Check "shop reachable" "WARN" "unreachable -- the producer will queue locally and drain when it returns"
}

Write-Host ""
if ($fails -gt 0) { Write-Host "$fails FAIL, $warns WARN -- fix the FAILs before the run." -ForegroundColor Red }
elseif ($warns -gt 0) { Write-Host "0 FAIL, $warns WARN -- it will run and report its limits honestly." -ForegroundColor Yellow }
else { Write-Host "All checks passed." -ForegroundColor Green }
Write-Host ""
exit $fails
