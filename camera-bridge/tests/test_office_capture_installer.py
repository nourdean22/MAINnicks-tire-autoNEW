from __future__ import annotations

import os
import shutil
import stat
import sys
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-office-capture.ps1"


def source() -> str:
    return INSTALLER.read_text(encoding="utf-8")


def _pwsh() -> str:
    exe = shutil.which("pwsh") or shutil.which("powershell.exe") or shutil.which("powershell")
    assert exe, "installer probe requires PowerShell 7 or Windows PowerShell"
    return exe


def _fake_ffmpeg(tmp_path: Path) -> Path:
    helper = tmp_path / "fake_ffmpeg.py"
    helper.write_text(
        """import os
import sys
from pathlib import Path

marker = os.environ.get("PROBE_MARKER")
if marker:
    Path(marker).write_text("invoked", encoding="utf-8")

args = sys.argv[1:]
if "-f" in args and "dshow" in args:
    Path(args[-1]).write_bytes(b"RIFF" + b"0" * 4096)
    raise SystemExit(0)
if "-af" in args and "volumedetect" in args:
    mean = os.environ.get("FAKE_MEAN_DB", "-20.0")
    print(f"mean_volume: {mean} dB", file=sys.stderr)
    print("max_volume: -3.0 dB", file=sys.stderr)
    raise SystemExit(0)
raise SystemExit(0)
""",
        encoding="utf-8",
    )

    if os.name == "nt":
        fake = tmp_path / "ffmpeg.cmd"
        fake.write_text(
            f'@echo off\r\n"{sys.executable}" "{helper}" %*\r\n',
            encoding="utf-8",
        )
    else:
        fake = tmp_path / "ffmpeg"
        fake.write_text(
            f'#!/bin/sh\nexec "{sys.executable}" "{helper}" "$@"\n',
            encoding="utf-8",
        )
        fake.chmod(fake.stat().st_mode | stat.S_IEXEC)
    return fake


def _run_dshow_probe(tmp_path: Path, *, mean_db: str = "-20.0", what_if: bool = False):
    _fake_ffmpeg(tmp_path)
    env = os.environ.copy()
    env["PATH"] = str(tmp_path) + os.pathsep + env.get("PATH", "")
    env["TEMP"] = str(tmp_path)
    env["FAKE_MEAN_DB"] = mean_db
    marker = tmp_path / "ffmpeg-invoked.txt"
    env["PROBE_MARKER"] = str(marker)
    cmd = [
        _pwsh(),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(INSTALLER),
        "-SourceUrl",
        "Fake Counter Mic",
        "-SourceKind",
        "DSHOW",
        "-IngestKey",
        "test-only",
        "-ProbeOnly",
    ]
    if what_if:
        cmd.append("-WhatIf")
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=30), marker


def test_default_is_headless_nicks_euclid_generic_source():
    text = source()
    assert '[ValidateSet("generic", "rtsp", "dshow")]' in text
    assert '[string]$SourceKind = "generic"' in text
    assert '[string]$SourceUrl = ""' in text
    assert '[string]$OfficeSerial = "T8410P5225154105"' in text
    assert 'http://127.0.0.1:3000/record/$OfficeSerial' in text
    assert "maxSeconds=$bridgeMaxSeconds" in text
    assert '$SourceKind -in @("rtsp", "generic")' in text
    assert '"-rw_timeout","15000000"' in text


def test_generic_and_rtsp_run_as_system_while_dshow_is_interactive():
    text = source()
    start = text.index("$action = New-ScheduledTaskAction")
    end = text.index("$settings = New-ScheduledTaskSettingsSet", start)
    block = text[start:end]

    assert 'if ($SourceKind -eq "dshow")' in block
    assert "Get-CimInstance Win32_ComputerSystem" in block
    assert "$DesktopUser" in block
    assert "New-ScheduledTaskTrigger -AtLogOn" in block
    assert "-LogonType Interactive" in block
    assert 'New-ScheduledTaskTrigger -AtStartup' in block
    assert 'UserId "SYSTEM"' in block
    assert "-LogonType ServiceAccount" in block


def test_task_arguments_do_not_embed_source_or_ingest_key():
    text = source()
    action = next(line for line in text.splitlines() if line.startswith("$action = New-ScheduledTaskAction"))
    assert "-m vision.officewake --capture" in action
    assert "$SourceUrl" not in action
    assert "$IngestKey" not in action

    assert '"CAMERA_INGEST_KEY" = $IngestKey' in text
    assert '"OFFICE_AUDIO_SOURCE" = $SourceUrl' in text
    assert '"OFFICE_AUDIO_INPUT_FORMAT" = $SourceKind' in text
    assert '"OFFICE_AUDIO_SOURCE_NAME" = $episodeSource' in text




def test_installer_requires_explicit_recording_policy_acknowledgment():
    text = source()
    assert "[switch]$AcknowledgeRecordingPolicy" in text
    assert "if (-not $AcknowledgeRecordingPolicy)" in text
    assert "recording policy has not been explicitly acknowledged" in text
    assert (
        '"OFFICE_AUDIO_POLICY_ACK" = $(if ($AcknowledgeRecordingPolicy) { "1" } else { "0" })'
        in text
    )


def test_installer_disables_legacy_continuous_task_and_self_restarts():
    text = source()
    assert 'Get-ScheduledTask -TaskName "NickOfficeCapture"' in text
    assert 'Disable-ScheduledTask -TaskName "NickOfficeCapture"' in text
    assert "-MultipleInstances IgnoreNew" in text
    assert "-RestartCount 999" in text
    assert "-ExecutionTimeLimit ([TimeSpan]::Zero)" in text


def test_default_headless_source_is_not_tied_to_chrome_or_desktop():
    text = source().lower()
    assert "chrome" in text  # documentation states the independence explicitly
    assert "without chrome" in text
    assert "generic" in text
    assert "fragmented-mp4" in text
    assert "directshow remains an explicit fallback" in text


def test_dshow_probe_behavior_accepts_real_signal(tmp_path: Path):
    result, marker = _run_dshow_probe(tmp_path, mean_db="-24.5")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "signal measured at -24.5 dBFS mean" in result.stdout
    assert marker.exists()


def test_dshow_probe_behavior_rejects_effective_silence(tmp_path: Path):
    result, marker = _run_dshow_probe(tmp_path, mean_db="-91.0")
    assert result.returncode != 0
    assert "effectively silent" in (result.stdout + result.stderr)
    assert marker.exists()
    assert not list(tmp_path.glob("nick-office-mic-*.wav"))


def test_probe_is_inert_under_whatif(tmp_path: Path):
    result, marker = _run_dshow_probe(tmp_path, what_if=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no probe file created" in result.stdout
    assert not marker.exists()
    assert not list(tmp_path.glob("nick-office-mic-*.wav"))
