<#
.SYNOPSIS
    Keep the V380 client alive AND renderable, because it is the producer's only sensor.
.DESCRIPTION
    `install-edge-runtime.ps1` self-heals the PRODUCER. Nothing self-healed the thing the
    producer reads. On the shop PC the V380 client is the entire sensor: if it exits, or if
    somebody dismisses it to the tray, the producer stalls, exits 3, gets restarted by the
    OS, stalls again, and loops -- looking busy while the lot goes unwatched.

    Three failures, three fixes, in the order they actually happen:

      1. PROCESS GONE. Relaunch. Launch `V380Login.exe`, never `V380.exe`: the latter is the
         post-auth binary and started directly it exits 0 immediately, with no window and
         without even writing its config. Measured on this box 2026-09-10.

      2. WINDOW NOT RENDERABLE. Windows Graphics Capture reads a window's composited
         surface. An OCCLUDED window still renders, which is why the operator can work over
         the top of it -- but a MINIMISED or HIDDEN one renders nothing at all and WGC
         delivers no frames. Restored with SW_SHOWNOACTIVATE (4), never SW_RESTORE (9): this
         runs on a machine somebody is using, and a monitoring agent has no business
         stealing their foreground window.

      3. THE "Tips" DIALOG. On this Celeron the client raises a recurring "current
         performance of the software is insufficient" dialog. It is ~440x350 and sits over
         the middle of the video area, so it lands INSIDE the channel-2 crop and feeds the
         detector a grey box instead of the lot. Best-effort dismissed here. It resists
         synthetic input (WM_CLOSE, PostMessage clicks, SendInput mouse and keys all bounce
         -- measured), so this is a try, not a guarantee, and the outcome is logged either
         way rather than assumed. The durable fix is operator-side: set the client to SD
         preview mode so it stops firing.

    Idempotent and quiet by design: a healthy pass logs one line and changes nothing, so the
    log stays readable and a real event is visible in it.
.EXAMPLE
    powershell -File scripts/v380-watchdog.ps1
    powershell -File scripts/v380-watchdog.ps1 -Install    # register the scheduled task
    powershell -File scripts/v380-watchdog.ps1 -Uninstall
#>
[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Uninstall,
    [string]$TaskName = "V380Watchdog",
    [int]$EveryMinutes = 3,
    [string]$Exe = "C:\Program Files (x86)\V380\V380Login.exe",
    [string]$WindowTitle = "V380"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root "logs"
$logFile = Join-Path $logDir "v380-watchdog.log"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

function Log($msg) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $msg
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Host $line
}

# --- install / uninstall ----------------------------------------------------
if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Log "watchdog task '$TaskName' removed"
    } else { Log "watchdog task '$TaskName' was not registered" }
    exit 0
}

if ($Install) {
    $self = Join-Path $PSScriptRoot "v380-watchdog.ps1"
    $action = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$self`"" `
        -WorkingDirectory $root
    # AtLogOn AND a repeating trigger: the logon run covers a reboot, the repeat covers
    # everything that happens during the 20+ day uptimes this box actually sees.
    $tLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:COMPUTERNAME\$env:USERNAME"
    $tRepeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
        -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes)
    $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -MultipleInstances IgnoreNew `
        -StartWhenAvailable
    # INTERACTIVE, never SYSTEM. This has to touch a window on the real desktop; Session 0
    # has none, so a SYSTEM task would find nothing to restore and report success doing it.
    $prn = New-ScheduledTaskPrincipal -UserId "$env:COMPUTERNAME\$env:USERNAME" `
        -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger @($tLogon, $tRepeat) `
        -Settings $set -Principal $prn -Force `
        -Description "Keeps the V380 client running and renderable for the edge producer." | Out-Null
    Log "watchdog task '$TaskName' registered (at logon + every $EveryMinutes min, interactive)"
    exit 0
}

# --- win32 ------------------------------------------------------------------
$sig = @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class V380W {
  delegate bool EP(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EP cb, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct PLACEMENT {
    public uint length; public uint flags; public uint showCmd;
    public int minX, minY, maxX, maxY; public RECT rcNormal; }
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr h, ref PLACEMENT p);
  public class Win { public IntPtr H; public int W; public int Ht; public bool Vis; public bool Icon; }
  public static List<Win> Windows(uint pid, string title) {
    var outp = new List<Win>();
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p != pid) return true;
      var c = new StringBuilder(256); GetClassName(h, c, 256);
      if (c.ToString() != "Qt5QWindowIcon") return true;
      var t = new StringBuilder(512); GetWindowText(h, t, 512);
      if (t.ToString().IndexOf(title, StringComparison.OrdinalIgnoreCase) < 0) return true;
      var pl = new PLACEMENT(); pl.length = (uint)Marshal.SizeOf(typeof(PLACEMENT));
      if (!GetWindowPlacement(h, ref pl)) return true;
      outp.Add(new Win { H = h, W = pl.rcNormal.R - pl.rcNormal.L,
                         Ht = pl.rcNormal.B - pl.rcNormal.T,
                         Vis = IsWindowVisible(h), Icon = IsIconic(h) });
      return true;
    }, IntPtr.Zero);
    return outp;
  }
}
'@
if (-not ("V380W" -as [type])) { Add-Type -TypeDefinition $sig }

# --- 1. process alive -------------------------------------------------------
$proc = Get-Process V380 -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) {
    if (-not (Test-Path $Exe)) { Log "FAIL V380 not running and launcher missing at $Exe"; exit 1 }
    Start-Process -FilePath $Exe -WorkingDirectory (Split-Path -Parent $Exe)
    Log "ACTION V380 was not running -- launched $Exe"
    Start-Sleep -Seconds 12
    $proc = Get-Process V380 -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { Log "FAIL V380 did not come up within 12s of launch"; exit 1 }
    Log "OK V380 up, pid=$($proc.Id)"
}

# --- 2. window renderable ---------------------------------------------------
# Ranked by rcNormalPosition, not the live rect: a minimised window's rect is its ~160x28
# taskbar placement, which is SMALLER than the Tips dialog, so a rect-based pick would
# "restore" the dialog and leave the video pane minimised.
$wins = [V380W]::Windows([uint32]$proc.Id, $WindowTitle)
$feed = $wins | Sort-Object { $_.W * $_.Ht } -Descending | Select-Object -First 1
if (-not $feed) {
    Log "WARN V380 pid=$($proc.Id) is running but owns no '$WindowTitle' window yet"
} else {
    if ($feed.Icon -or (-not $feed.Vis)) {
        $state = if ($feed.Icon) { "minimised" } else { "hidden" }
        [void][V380W]::ShowWindow($feed.H, 4)   # SW_SHOWNOACTIVATE
        Start-Sleep -Milliseconds 800
        $after = [V380W]::Windows([uint32]$proc.Id, $WindowTitle) | Where-Object { $_.H -eq $feed.H }
        $ok = $after -and $after.Vis -and (-not $after.Icon)
        Log ("ACTION feed window {0} ({1}x{2}) was {3} -- restored without focus; renderable now: {4}" -f `
             $feed.H, $feed.W, $feed.Ht, $state, $ok)
    } else {
        Log ("OK V380 pid={0} feed={1} {2}x{3} visible" -f $proc.Id, $feed.H, $feed.W, $feed.Ht)
    }
}

# --- 3. the view itself ------------------------------------------------------
# A relaunched client comes up as an EMPTY 2x2 grid. The window is present, visible and
# renderable, so steps 1 and 2 both report success while the producer captures four grey
# boxes. Restoring the layout needs real clicks in a measured order, which lives in
# restore_v380_view.py; it is a no-op when the view is already loaded.
$py = (Get-Command python -ErrorAction SilentlyContinue)
$restore = Join-Path $PSScriptRoot "restore_v380_view.py"
if (-not $py) {
    Log "WARN python not on PATH -- cannot check whether the view is loaded"
} elseif (-not (Test-Path $restore)) {
    Log "WARN $restore missing -- view cannot be restored"
} else {
    $out = & $py.Source $restore 2>&1
    $rc = $LASTEXITCODE
    $line = ($out | Where-Object { $_ -match "^(OK|ACTION|FAIL)" } | Select-Object -Last 1)
    if (-not $line) { $line = ($out | Select-Object -Last 1) }
    if ($rc -eq 0) { Log "view: $line" } else { Log "FAIL view: $line" }
}

# --- 4. Tips dialog over the video ------------------------------------------
# Only the ones small enough to be a dialog; the feed itself is excluded by size.
$dialogs = $wins | Where-Object { $_.Vis -and $_.W -ge 380 -and $_.W -le 520 -and $_.Ht -le 420 }
foreach ($d in $dialogs) {
    $r = [IntPtr]::Zero
    [void][V380W]::SendMessageTimeout($d.H, 0x0112, [IntPtr]0xF060, [IntPtr]0, 0x0002, 1500, [ref]$r)  # WM_SYSCOMMAND / SC_CLOSE
    Start-Sleep -Milliseconds 600
    $gone = -not ([V380W]::Windows([uint32]$proc.Id, $WindowTitle) | Where-Object { $_.H -eq $d.H -and $_.Vis })
    if ($gone) { Log "ACTION dismissed a $($d.W)x$($d.Ht) dialog sitting over the video pane" }
    else { Log "WARN a $($d.W)x$($d.Ht) dialog is over the video pane and refused SC_CLOSE -- set the client to SD preview mode to stop it recurring" }
}
exit 0
