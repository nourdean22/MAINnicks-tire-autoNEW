<#
.SYNOPSIS
    One pass that keeps the whole shop-PC car counter alive. Headless by design.
.DESCRIPTION
    The counter is a chain, and every link has its own way of dying quietly:

      V380 client  -> exits, or gets minimised, or comes back as an empty grid
      its window   -> must be un-minimised and showing SHOPSIGN's 3-channel view
      producer     -> exits 3 on a stall, or its task gets disabled

    Each link had a separate fix and no single thing checked all of them, so a healthy
    report from any one of them meant nothing about the lot actually being counted. This
    is the one entry point: run it and the chain is either up or it tells you which link
    is not, with the reason.

    HEADLESS. Shop staff use this machine. A healthy pass touches NOTHING -- it does not
    raise a window, move the mouse, or take focus. Repairs are the only thing that
    interact, they only run after a failure is confirmed twice (so a mid-repaint blip
    cannot yank somebody's cursor), and they put the window back behind the user's work
    and return the cursor when done. Windows Graphics Capture reads a window's own
    composited surface, so V380 can sit buried behind everything and the producer still
    sees the lot perfectly -- which is what makes headless possible at all.

    Run it from the scheduled task (-Install) and it is the only thing you need scheduled.
.EXAMPLE
    powershell -File scripts/shop-pc-keepalive.ps1            # one pass
    powershell -File scripts/shop-pc-keepalive.ps1 -Install   # schedule it (logon + every 3 min)
    powershell -File scripts/shop-pc-keepalive.ps1 -Status    # report only, change nothing
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Status,
    [string]$TaskName = "ShopPcKeepalive",
    [string]$ProducerTask = "NickEdgeProducer",
    [int]$EveryMinutes = 3
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir "keepalive.log"

function Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Host $line
}

if ($Uninstall) {
    foreach ($t in @($TaskName, "V380Watchdog")) {
        if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $t -Confirm:$false
            Log "removed scheduled task '$t'"
        }
    }
    exit 0
}

if ($Install) {
    # Supersedes the standalone V380 watchdog: two tasks clicking the same window on
    # different timers is a race, and the loser's clicks land on whatever the winner
    # just changed.
    if (Get-ScheduledTask -TaskName "V380Watchdog" -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName "V380Watchdog" -Confirm:$false
        Log "removed the standalone 'V380Watchdog' task -- this one supersedes it"
    }
    $self = Join-Path $PSScriptRoot "shop-pc-keepalive.ps1"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`"" `
        -WorkingDirectory $root
    $tLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$env:USERNAME"
    $tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew -StartWhenAvailable
    # INTERACTIVE, never SYSTEM: this has to see and touch a window on the real desktop,
    # and Session 0 has no desktop at all -- a SYSTEM task would find nothing and say it
    # succeeded.
    $prn = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" `
        -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($tLogon, $tRepeat) `
        -Settings $set -Principal $prn -Force `
        -Description "Keeps the V380 client, its view, and the edge producer alive. Headless." | Out-Null
    Log "registered '$TaskName' (at logon + every $EveryMinutes min, interactive, hidden)"
    exit 0
}

# ---------------------------------------------------------------------------
$problems = @()

# --- link 1+2: the V380 client and its window -------------------------------
if ($Status) {
    $v = Get-Process V380 -ErrorAction SilentlyContinue
    if ($v) { Log "STATUS v380: running pid=$($v.Id)" } else { Log "STATUS v380: NOT RUNNING"; $problems += "v380" }
} else {
    $wd = Join-Path $PSScriptRoot "v380-watchdog.ps1"
    if (Test-Path $wd) {
        $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wd 2>&1
        foreach ($l in $out) { if ("$l" -match "ACTION|FAIL|WARN") { Log "v380: $l" } }
        if ($out -match "FAIL") { $problems += "v380" }
    } else { Log "FAIL $wd missing"; $problems += "v380" }
}

# --- link 3: the producer ---------------------------------------------------
# Two separate things can be wrong and they need different fixes: the TASK can be
# disabled (nothing will ever start it again), or the task can be fine while the PROCESS
# is gone between restarts. Checking only one of them is how this stayed down for days.
$task = Get-ScheduledTask -TaskName $ProducerTask -ErrorAction SilentlyContinue
if (-not $task) {
    Log "FAIL producer task '$ProducerTask' is not registered -- run scripts/install-edge-runtime.ps1"
    $problems += "producer-task"
} else {
    if ($task.State -eq "Disabled") {
        if ($Status) { Log "STATUS producer: task DISABLED" ; $problems += "producer" }
        else {
            Enable-ScheduledTask -TaskName $ProducerTask | Out-Null
            Log "ACTION producer task was Disabled -- enabled it"
        }
    }
    $proc = Get-Process python -ErrorAction SilentlyContinue |
            Where-Object { $_.Path -and $_.Path -like "*Python314*" } | Select-Object -First 1
    $state = (Get-ScheduledTask -TaskName $ProducerTask).State
    if (-not $proc -and $state -ne "Running") {
        if ($Status) { Log "STATUS producer: not running (task $state)"; $problems += "producer" }
        else {
            Start-ScheduledTask -TaskName $ProducerTask
            Log "ACTION producer was not running (task $state) -- started it"
        }
    } elseif ($Status) {
        Log ("STATUS producer: task={0} pid={1}" -f $state, $(if ($proc) { $proc.Id } else { "(starting)" }))
    }
}

# --- is it actually counting? ----------------------------------------------
# Liveness is not the same as working. The producer can be up, on the right window, and
# still recording nothing -- so report the store the lot actually lands in.
$traj = Join-Path $root "data\trajectories.sqlite"
if (Test-Path $traj) {
    $py = (Get-Command python -ErrorAction SilentlyContinue)
    if ($py) {
        $q = "import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);" +
             "print(c.execute('select count(*),count(distinct track_id) from track_points').fetchone())"
        $rows = (& $py.Source -c $q $traj 2>&1)
        Log "counting: track_points $rows"
    }
} else {
    Log "WARN no trajectories store yet at $traj"
}

if ($problems.Count -eq 0) { Log "chain OK" } else { Log ("chain DEGRADED: " + ($problems -join ", ")) }
exit $problems.Count
