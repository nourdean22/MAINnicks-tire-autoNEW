from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install-office-capture.ps1"


def source() -> str:
    return INSTALLER.read_text(encoding="utf-8")


def test_installer_supports_rtsp_and_windows_counter_mic():
    text = source()
    assert '[ValidateSet("rtsp", "dshow")]' in text
    assert '$SourceKind -eq "dshow"' in text
    assert "-f dshow" in text
    assert "NICK_OFFICE_AUDIO_SOURCE" in text
    assert "NICK_OFFICE_AUDIO_INPUT_FORMAT" in text
    assert '"--input-format"' in text


def test_local_mic_uses_interactive_logon_not_system_service_session():
    text = source()
    start = text.index('$action = New-ScheduledTaskAction')
    end = text.index("# RestartCount/Interval", start)
    block = text[start:end]

    assert "New-ScheduledTaskTrigger -AtLogOn" in block
    assert "-LogonType Interactive" in block
    assert 'UserId "SYSTEM"' in block, "RTSP fallback must remain service-capable"


def test_installer_keeps_source_secret_out_of_task_arguments():
    text = source()
    arg_start = text.index("$argList = @(")
    arg_end = text.index("$action =", arg_start)
    args = text[arg_start:arg_end]

    assert "%NICK_OFFICE_AUDIO_SOURCE%" in args
    assert "%NICK_OFFICE_AUDIO_INPUT_FORMAT%" in args
    assert "$SourceUrl" not in args
    assert "$IngestKey" not in args
