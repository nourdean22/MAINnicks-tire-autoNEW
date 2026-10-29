"""The front-desk PC sign counter installer (lot vision v2 phase 4).

The front-desk PC becomes the primary (p1) sign producer: the V380Decoder relay, MediaMTX, the
NicksMax crop and the edge, all under ONE SYSTEM task at below-normal priority, run by
cloud/run_cloud.py --primary. The relay and MediaMTX are downloaded at the phase 3 pins and
must fail closed on any byte or hash change; the V380 login is typed by Nour and kept in a
LocalMachine DPAPI file only SYSTEM and Administrators can read.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-frontdesk-sign.ps1"
LAUNCHER = ROOT / "scripts" / "run-frontdesk-sign.ps1"

RELAY_SHA = "3125fbefb9bc4a14faa8ec80d35c06e6bf00c9a20134c6c9b17196dc118a8126"
RELAY_BYTES = 10869110
MTX_SHA = "a84224f5a490855684e62ba6fb71e80ea2a5e16aed61883bb58380290e93e467"
MTX_BYTES = 28583662


def installer() -> str:
    return INSTALLER.read_text(encoding="utf-8")


def launcher() -> str:
    return LAUNCHER.read_text(encoding="utf-8")


def _pwsh() -> str:
    exe = shutil.which("powershell.exe") or shutil.which("pwsh") or shutil.which("powershell")
    assert exe, "installer probe requires Windows PowerShell or PowerShell 7"
    return exe


def _verify(tmp_path: Path, relay: Path):
    cmd = [_pwsh(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(INSTALLER),
           "-VerifyOnly", "-RelayZip", str(relay), "-Root", str(tmp_path / "lot-vision")]
    # No ProgramData: CI runs this on Linux pwsh, where it does not exist (red on PR 3317).
    env = {k: v for k, v in os.environ.items() if k.lower() != "programdata"}
    return subprocess.run(cmd, capture_output=True, text=True, timeout=60, env=env)


def test_pins_are_the_phase_3_windows_pins():
    text = installer()
    assert "https://github.com/PyanSofyan/V380Decoder/releases/download/v1.0.4/V380Decoder-win-x64.zip" in text
    assert RELAY_SHA in text and str(RELAY_BYTES) in text
    assert "https://github.com/bluenviron/mediamtx/releases/download/v1.21.2/mediamtx_v1.21.2_windows_amd64.zip" in text
    assert MTX_SHA in text and str(MTX_BYTES) in text


def test_wrong_byte_count_stops_before_anything_is_extracted(tmp_path):
    fake = tmp_path / "V380Decoder-win-x64.zip"
    fake.write_bytes(b"not the release")
    r = _verify(tmp_path, fake)
    out = r.stdout + r.stderr
    assert r.returncode != 0, out
    assert "STOP" in out and "bytes" in out, out
    assert not (tmp_path / "lot-vision" / "bin").exists()


def test_right_size_wrong_hash_stops(tmp_path):
    fake = tmp_path / "V380Decoder-win-x64.zip"
    with open(fake, "wb") as fh:
        fh.truncate(RELAY_BYTES)
    r = _verify(tmp_path, fake)
    out = r.stdout + r.stderr
    assert r.returncode != 0, out
    assert "STOP" in out and "SHA-256" in out, out


def test_one_system_task_below_normal_priority_that_self_heals():
    text = installer()
    assert 'New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount' in text
    assert "-Priority 7" in text  # 7 = below normal: the front-desk PC is a staff machine
    assert "New-ScheduledTaskTrigger -AtStartup" in text
    assert "-RepetitionDuration" in text  # a trigger with no duration never repeats
    assert "-MultipleInstances IgnoreNew" in text
    assert "-RestartCount 999" in text


def test_task_command_line_carries_no_secret():
    text = installer()
    action = next(line for line in text.splitlines() if "New-ScheduledTaskAction" in line)
    assert "run-frontdesk-sign.ps1" in action
    for word in ("Password", "password", "IngestKey", "V380_"):
        assert word not in action


def test_v380_login_is_typed_by_nour_and_kept_machine_scoped():
    text = installer()
    assert "Read-Host -AsSecureString" in text
    assert "[Security.Cryptography.DataProtectionScope]::LocalMachine" in text
    assert "/inheritance:r" in text  # only SYSTEM and Administrators may read the file
    assert "$env:ProgramData" in text  # never inside the copied code folder
    # The non-secret settings file must not carry the login.
    start = text.index("$settings = [ordered]@{")
    block = text[start:text.index("}", start)]
    assert "assword" not in block and "V380" not in block


def test_installer_reuses_the_office_lane_ingest_key_and_never_asks_for_it():
    text = installer()
    assert '[Environment]::GetEnvironmentVariable("CAMERA_INGEST_KEY", "Machine")' in text
    assert "IngestKey" not in text


def test_launcher_runs_the_primary_launcher_as_the_shop_producer():
    text = launcher()
    assert '"-m", "cloud.run_cloud", "--primary"' in text
    assert '$env:EDGE_ROLE = "shop"' in text  # p1-shop-sign: the existing lease's top priority
    assert "[Security.Cryptography.DataProtectionScope]::LocalMachine" in text
    assert "Remove-Item Env:\\V380_PASSWORD" in text


def test_launcher_sets_the_calibration_only_when_one_is_installed():
    text = launcher()
    assert "if (Test-Path -LiteralPath $calibration) { $env:EDGE_CALIBRATION = $calibration }" in text


def test_secret_folder_is_locked_down_before_the_login_is_written():
    text = installer()
    assert text.index("/inheritance:r") < text.index("WriteAllText($secretFile")


def test_uninstall_and_reinstall_end_the_lane_children_not_just_the_task():
    text = installer()
    uninstall = text[text.index("if ($Uninstall) {"):]
    assert uninstall.index("Stop-FrontDeskSign") < uninstall.index("UNINSTALLED")
    assert text.index("Stop-FrontDeskSign  #") < text.index("Expand-Archive")
    assert 'Contains("127.0.0.1:8555/sign")' in text


def _lane_functions() -> str:
    """The installer's process-matching code, cut out so a probe can run it against fake processes."""
    text = installer()
    start = min(i for i in (text.find("function Test-FrontDeskLaneProcess"), text.find("function Stop-FrontDeskSign")) if i >= 0)
    end = text.index("\n}\n", text.index("function Stop-FrontDeskSign")) + 3
    return text[start:end]


def test_stop_ends_only_this_lane_never_the_office_lane_venv_or_a_sibling_folder(tmp_path):
    """Reinstall and uninstall run Stop-FrontDeskSign; it must leave the office capture lane alone.

    Root is the parent of camera-bridge, so camera-bridge/.venv (the interpreter that
    install-office-capture.ps1 registers) sits under Root. The old filter killed every process whose
    exe started with Root as a plain string, which also matched the sibling folder NickLotVision2.
    """
    probe = tmp_path / "probe.ps1"
    probe.write_text(
        r"""$ErrorActionPreference = 'Stop'
$Root = Join-Path $env:PROBE_DIR 'NickLot'
$bridge = Join-Path $Root 'camera-bridge'
$sibling = Join-Path $env:PROBE_DIR 'NickLotVision2'
$TaskName = 'probe'
$script:killed = @()
function Stop-ScheduledTask { }
function Start-Sleep { }
function Stop-Process { [CmdletBinding()] param($Id, [switch]$Force) $script:killed += $Id }
function J { $p = $args[0]; foreach ($c in $args[1..($args.Count - 1)]) { $p = Join-Path $p $c }; $p }
function P($id, $exe, $cmd, $name) { [pscustomobject]@{ ProcessId = $id; ExecutablePath = $exe; CommandLine = $cmd; Name = $name } }
function Get-CimInstance {
  param($ClassName)
  P 1001 (J $Root 'venv' 'Scripts' 'python.exe') 'python.exe -m cloud.run_cloud --primary' 'python.exe'
  P 1002 (J $Root 'bin' 'relay' 'V380Decoder.exe') $null 'V380Decoder.exe'
  P 1003 (J $bridge '.venv' 'Scripts' 'python.exe') 'python.exe -m vision.officewake --capture' 'python.exe'
  P 1004 (J $sibling 'venv' 'Scripts' 'python.exe') 'python.exe -m something_else' 'python.exe'
  P 1005 (J $env:PROBE_DIR 'shell' 'pwsh.exe') ('pwsh.exe -NoExit -Command cd ' + $Root) 'pwsh.exe'
  P 1006 (J $Root 'venv2' 'Scripts' 'python.exe') 'python.exe -m other' 'python.exe'
  P 1007 (J $env:PROBE_DIR 'elsewhere' 'python.exe') ('python.exe ' + (Join-Path $bridge 'edge_main.py')) 'python.exe'
}
"""
        + _lane_functions()
        + "\nStop-FrontDeskSign | Out-Null\nWrite-Output ('KILLED=' + (($script:killed | Sort-Object) -join ','))\n",
        encoding="utf-8",
    )
    env = dict(os.environ, PROBE_DIR=str(tmp_path))
    done = subprocess.run([_pwsh(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(probe)],
                          capture_output=True, text=True, timeout=60, env=env)
    assert done.returncode == 0, done.stderr + done.stdout
    killed = next(line for line in done.stdout.splitlines() if line.startswith("KILLED="))
    # 1001 lane venv, 1002 lane relay, 1007 edge by command line. Never 1003 (office lane), 1004/1006 (siblings), 1005 (shell).
    assert killed == "KILLED=1001,1002,1007"


def test_launcher_keeps_a_week_of_earlier_run_logs():
    # The login-hold kill criterion reads 7 days of relay lines; one .prev lost them on the third restart (Codex on #3349).
    text = launcher()
    assert '+ ".prev"' not in text
    assert 'Move-Item -LiteralPath $log -Destination ($log + "." + $stamp)' in text
    assert "AddDays(-8)" in text
