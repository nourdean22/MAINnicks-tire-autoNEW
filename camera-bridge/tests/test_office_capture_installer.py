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
    exe = shutil.which("pwsh")
    assert exe, "GitHub runner must provide pwsh so the Windows installer probe is behavior-tested"
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


def _run_probe(tmp_path: Path, *, mean_db: str = "-20.0", what_if: bool = False):
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


def test_installer_supports_rtsp_and_windows_counter_mic():
    text = source()
    assert '[ValidateSet("rtsp", "dshow")]' in text
    assert '$SourceKind = $SourceKind.ToLowerInvariant()' in text
    assert "NICK_OFFICE_AUDIO_SOURCE" in text
    assert "NICK_OFFICE_AUDIO_INPUT_FORMAT" in text
    assert '"--source", $episodeSource' in text
    assert "--source-url" not in text[text.index("$argList = @("):text.index("$action =", text.index("$argList = @("))]
    assert "--input-format" not in text[text.index("$argList = @("):text.index("$action =", text.index("$argList = @("))]
    assert '"counter-mic"' in text


def test_local_mic_uses_interactive_desktop_user_not_elevation_identity():
    text = source()
    start = text.index('$action = New-ScheduledTaskAction')
    end = text.index("# RestartCount/Interval", start)
    block = text[start:end]

    assert "Get-CimInstance Win32_ComputerSystem" in block
    assert "$DesktopUser" in block
    assert "WindowsIdentity]::GetCurrent().Name" not in block
    assert "New-ScheduledTaskTrigger -AtLogOn" in block
    assert "-LogonType Interactive" in block
    assert 'UserId "SYSTEM"' in block, "RTSP fallback must remain service-capable"


def test_installer_keeps_source_secret_out_of_task_arguments_and_clears_legacy_rtsp():
    text = source()
    arg_start = text.index("$argList = @(")
    arg_end = text.index("$action =", arg_start)
    args = text[arg_start:arg_end]

    assert "%NICK_OFFICE_AUDIO_SOURCE%" not in args
    assert "%NICK_OFFICE_AUDIO_INPUT_FORMAT%" not in args
    assert "$SourceUrl" not in args
    assert "$IngestKey" not in args
    assert "--source-url" not in args
    assert "--input-format" not in args
    assert 'SetEnvironmentVariable("NICK_OFFICE_RTSP", $null, "Machine")' in text


def test_verification_command_is_dry_run_first():
    text = source()
    assert "--seconds 60 --dry-run" in text
    assert "Only after reviewing the dry-run output" in text


def test_dshow_probe_behavior_accepts_real_signal(tmp_path):
    result, marker = _run_probe(tmp_path, mean_db="-24.5")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "signal measured at -24.5 dBFS mean" in result.stdout
    assert marker.exists()


def test_dshow_probe_behavior_rejects_effective_silence(tmp_path):
    result, marker = _run_probe(tmp_path, mean_db="-91.0")
    assert result.returncode != 0
    assert "effectively silent" in (result.stdout + result.stderr)
    assert marker.exists()
    assert not list(tmp_path.glob("nick-office-mic-probe-*.wav"))


def test_dshow_probe_is_inert_under_whatif(tmp_path):
    result, marker = _run_probe(tmp_path, what_if=True)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "no probe file created" in result.stdout
    assert not marker.exists()
    assert not list(tmp_path.glob("nick-office-mic-probe-*.wav"))
