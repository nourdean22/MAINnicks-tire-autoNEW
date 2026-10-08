"""Behaviour probes for scripts/nicksmax/nicksmax-camera-supervisor.ps1.

The supervisor is the only thing that restarts the Eufy bridge/agent and the office worker on
NicksMax, so a wrong restart primitive is an outage generator, not a bug. Witnessed before this
suite existed (2026-10-03 13:57, 2026-10-05 16:52): Stop-ScheduledTask ended the powershell.exe
wrapper, the node/python child kept the port, and the restarted task died on EADDRINUSE ~24x/hour
next to the orphan while two agents posted at once.

Two layers:
  * text assertions pin the constants and the shape of the script (cheap, run everywhere);
  * `tests/fixtures/supervisor_harness.ps1` loads the script's FUNCTIONS (via the PowerShell AST,
    never its top-level body), shadows Get-CimInstance / Stop-Process / *-ScheduledTask /
    Get-NetTCPConnection / Port-Open with fakes, runs one scenario and prints JSON. Those probes
    assert what the supervisor DOES: which pids it ends, in what order, how many ticks it waits.

Positive control (2026-10-07): every probe below was run against the pre-fix script first and
failed (no Heal-* functions, 400 ms probe, two-miss restart, warn-only disk floor) while
`test_script_parses` passed on both -- the instrument fires on the defect it was built for.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SUPERVISOR = ROOT / "scripts" / "nicksmax" / "nicksmax-camera-supervisor.ps1"
HARNESS = ROOT / "tests" / "fixtures" / "supervisor_harness.ps1"

BRIDGE_TASK = "StateNour-Eufy-Bridge-NicksMax"
AGENT_TASK = "StateNour-Eufy-Agent-NicksMax"
OFFICE_TASK = "StateNour-OfficeIntelligence-NicksMax"


def source() -> str:
    return SUPERVISOR.read_text(encoding="utf-8")


def _pwsh() -> str:
    exe = shutil.which("pwsh") or shutil.which("powershell.exe") or shutil.which("powershell")
    assert exe, "supervisor probes require PowerShell 7 or Windows PowerShell"
    return exe


def run_scenario(name: str, tmp_path: Path) -> dict:
    cmd = [
        _pwsh(),
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        str(HARNESS),
        "-ScriptPath",
        str(SUPERVISOR),
        "-Scenario",
        name,
        "-WorkDir",
        str(tmp_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    assert result.returncode == 0, f"harness failed\nSTDOUT:\n{result.stdout}\nSTDERR:\n{result.stderr}"
    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert lines, result.stderr
    return json.loads(lines[-1])


def _index(calls: list[str], needle: str) -> int:
    assert needle in calls, f"{needle!r} not in {calls}"
    return calls.index(needle)


# ---- text: constants and shape ----------------------------------------------------------------


def test_script_parses():
    tokens_errors = subprocess.run(
        [
            _pwsh(),
            "-NoProfile",
            "-Command",
            "$t=$null;$e=$null;"
            "[void][System.Management.Automation.Language.Parser]::ParseFile("
            f"'{SUPERVISOR}',[ref]$t,[ref]$e);"
            "if($e.Count){$e|ForEach-Object{$_.Message};exit 1};exit 0",
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert tokens_errors.returncode == 0, tokens_errors.stdout + tokens_errors.stderr


def test_port_probe_waits_long_enough_for_a_busy_listener():
    # 2026-10-07 06:36: a 400 ms probe reported a healthy bridge as closed. One slow accept must
    # not be a restart vote.
    text = source()
    assert "function Port-Open([int]$port,[int]$timeoutMs = 1500)" in text
    assert "WaitOne($timeoutMs,$false)" in text
    assert "WaitOne(400" not in text


def test_eufy_restart_needs_three_consecutive_misses():
    text = source()
    assert "$eufyPortMissesBeforeRestart = 3" in text
    assert "$e.portMisses -ge $eufyPortMissesBeforeRestart" in text
    assert "portMisses -ge 2" not in text


def test_restart_primitive_ends_children_between_stop_and_start():
    text = source()
    kick = text[text.index("function Kick-Task") : text.index("function ", text.index("function Kick-Task") + 10)]
    stop_task = kick.index("Stop-ScheduledTask")
    stop_children = kick.index("Stop-TaskChildren $key")
    start_task = kick.index("Start-ScheduledTask")
    assert stop_task < stop_children < start_task


def test_child_specs_name_the_real_processes_by_image_and_port():
    text = source()
    spec = text[text.index("function Get-TaskChildSpec") : text.index("function Stop-TaskChildren")]
    assert "server\\.mjs" in spec and "go2rtc" in spec and "3000" in spec
    assert "agent\\.py" in spec and "--eufy-only" in spec and "3601" in spec
    assert "vision\\.officewake" in spec


def test_port_owner_kill_refuses_unexpected_images():
    text = source()
    block = text[text.index("function Stop-PortOwner") : text.index("function Remove-DuplicateProcesses")]
    assert "$owner -eq $PID" in block
    assert "-notmatch '^(node|python\\w*|go2rtc)$'" in block
    assert "not a camera child; leaving it" in block


def test_eufy_watchdog_task_is_retired_as_a_second_authority():
    text = source()
    retired = text[text.index('foreach ($taskName in @("V380Watchdog"') : text.index("SAFETY disabled retired task")]
    assert "StateNour-Eufy-Watchdog-NicksMax" in retired


def test_solar_escalation_message_is_time_aware():
    text = source()
    assert "$daylight = ($hour -ge 8 -and $hour -lt 18)" in text
    assert "login refused in DAYLIGHT" in text
    assert "expected overnight" in text


def test_disk_floor_acts_instead_of_only_warning():
    text = source()
    block = text[text.index("if ($free -lt $diskFloorBytes)") : text.index("$state | ConvertTo-Json")]
    assert "$officeAudioDir" in block
    assert "AddHours(-6)" in block
    assert "Remove-Item -LiteralPath" in block
    assert "rotated the supervisor log" in block
    assert "ESCALATE disk free" in block
    assert "elseif ($free -lt $diskWarnBytes)" in block
    assert "$diskFloorBytes = 1GB" in text and "$diskWarnBytes = 2GB" in text


def test_listening_coverage_floor_is_read_from_the_office_status():
    text = source()
    assert "$officeListeningCoverageFloor = 0.5" in text
    assert "conversationListeningCoverage60m" in text
    assert '@("READY","CAPTURING")' in text
    assert "listened only" in text


def test_edge_code_change_is_checked_before_the_arm_path_and_recorded_on_every_start():
    # A `git pull` must be the deploy for the sign edge as it already is for the office worker:
    # the check runs where the start path can reload the edge in the same tick, and every start
    # records the fingerprint it loaded so the next tick does not restart it again for nothing.
    text = source()
    heal = text.index("if (Heal-EdgeCode $armed $prodHealthy ([bool]$prodStarting))")
    arm = text.index("if ($armed) {")
    start = text.index("authoritative RTSP sign producer started after decoded-frame proof")
    recorded = text.index('(Get-Entry "edge-code-version").fingerprint = Get-EdgeCodeFingerprint $root')
    assert heal < arm < start < recorded
    fingerprint = text[text.index("function Get-EdgeCodeFingerprint") : text.index("function Heal-EdgeCode")]
    assert '"edge_main.py","edge_health.py"' in fingerprint
    assert '-notlike "office*.py"' in fingerprint


# ---- behaviour: the harness runs the supervisor's own functions against fakes -----------------


def test_restart_ends_the_real_children_in_order(tmp_path: Path):
    out = run_scenario("kick-restart-order", tmp_path)
    calls = out["calls"]
    stop_task = _index(calls, f"stop-task:{BRIDGE_TASK}")
    start_task = _index(calls, f"start-task:{BRIDGE_TASK}")
    node = _index(calls, "stop-pid:11")
    go2rtc = _index(calls, "stop-pid:12")
    assert stop_task < node < start_task
    assert stop_task < go2rtc < start_task
    # The editor with a go2rtc.yaml open and the agent are NOT bridge children.
    assert "stop-pid:13" not in calls
    assert "stop-pid:21" not in calls
    assert len(out["state"]["eufy-bridge"]["restarts"]) == 1


def test_duplicate_agents_keep_the_port_owner(tmp_path: Path):
    out = run_scenario("dedupe-agent-keeps-port-owner", tmp_path)
    assert out["calls"] == ["stop-pid:21"]
    assert any("duplicate eufy-agent pid=21; keeping pid=22" in line for line in out["log"])


def test_duplicate_agents_keep_the_oldest_when_nobody_owns_the_port(tmp_path: Path):
    out = run_scenario("dedupe-agent-keeps-oldest-without-owner", tmp_path)
    # Dedupe ends the newcomer; the closed port is ONE miss, never a restart on its own.
    assert out["calls"] == ["stop-pid:22"]
    assert out["state"]["eufy-agent"]["portMisses"] == 1


def test_orphaned_listener_is_reclaimed_once_not_started_beside(tmp_path: Path):
    out = run_scenario("reclaim-orphan", tmp_path)
    calls = out["calls"]
    assert f"stop-task:{BRIDGE_TASK}" not in calls  # the task is not running; nothing to stop
    assert calls.count(f"start-task:{BRIDGE_TASK}") == 1
    assert _index(calls, "stop-pid:11") < _index(calls, f"start-task:{BRIDGE_TASK}")
    assert _index(calls, "stop-pid:12") < _index(calls, f"start-task:{BRIDGE_TASK}")
    assert any(line.find("RECLAIM eufy-bridge") >= 0 for line in out["log"])
    # Second pass in the same window: the orphan is gone and the start is rate-limited.
    assert len(out["state"]["eufy-bridge"]["restarts"]) == 1


def test_ready_task_with_closed_port_is_simply_started(tmp_path: Path):
    out = run_scenario("start-when-ready-and-closed", tmp_path)
    assert out["calls"] == [f"start-task:{BRIDGE_TASK}"]


def test_running_task_with_closed_port_restarts_on_the_third_miss_only(tmp_path: Path):
    out = run_scenario("three-misses-before-restart", tmp_path)
    assert out["markers"]["callsAfterTwoTicks"] == 0
    calls = out["calls"]
    assert _index(calls, f"stop-task:{BRIDGE_TASK}") < _index(calls, "stop-pid:11") < _index(calls, f"start-task:{BRIDGE_TASK}")
    assert out["state"]["eufy-bridge"]["portMisses"] == 0


def test_office_orphan_is_reclaimed_before_the_task_starts(tmp_path: Path):
    out = run_scenario("office-orphan-reclaimed", tmp_path)
    calls = out["calls"]
    assert _index(calls, "stop-pid:31") < _index(calls, f"start-task:{OFFICE_TASK}")
    assert f"stop-task:{OFFICE_TASK}" not in calls
    assert any("RECLAIM office-worker" in line for line in out["log"])


def test_office_stale_heartbeat_restart_ends_the_python_child(tmp_path: Path):
    out = run_scenario("office-heartbeat-stale-restarts", tmp_path)
    calls = out["calls"]
    assert _index(calls, f"stop-task:{OFFICE_TASK}") < _index(calls, "stop-pid:31") < _index(calls, f"start-task:{OFFICE_TASK}")


def test_office_low_listening_coverage_warns_once(tmp_path: Path):
    out = run_scenario("office-coverage-low-warns", tmp_path)
    assert out["calls"] == []
    warns = [line for line in out["log"] if "WARN office worker reports READY but listened only" in line]
    assert len(warns) == 1, out["log"]  # two passes in one tick, said once


def test_office_healthy_coverage_is_silent(tmp_path: Path):
    out = run_scenario("office-coverage-ok-silent", tmp_path)
    assert out["calls"] == []
    assert not [line for line in out["log"] if "listened only" in line]


def test_office_low_coverage_in_a_quiet_hour_is_silent(tmp_path: Path):
    # No wakes, no failures: a quiet office, not a deaf worker. Low coverage alone is not a WARN.
    out = run_scenario("office-coverage-low-quiet-silent", tmp_path)
    assert out["calls"] == []
    assert not [line for line in out["log"] if "listened only" in line]


def test_office_low_coverage_with_wakes_but_no_captures_warns(tmp_path: Path):
    out = run_scenario("office-coverage-low-deaf-warns", tmp_path)
    warns = [line for line in out["log"] if "listened only" in line]
    assert len(warns) == 1, out["log"]
    assert "(4 wakes, 0 captures, 0 failed)" in warns[0]


def test_disk_floor_prunes_stale_audio_and_rotates_the_log(tmp_path: Path):
    out = run_scenario("disk-floor", tmp_path)
    assert out["markers"]["staleAudioRemains"] is False
    assert out["markers"]["freshAudioRemains"] is True
    assert out["markers"]["rotatedLogExists"] is True
    assert any("ACTION disk floor: removed 1 raw audio files" in line for line in out["log"])
    assert any("ESCALATE disk free" in line for line in out["log"])


def test_edge_code_change_ends_the_production_edge_once_and_records_it(tmp_path: Path):
    out = run_scenario("edge-code-changed-restarts", tmp_path)
    m = out["markers"]
    assert m["first"] is True
    assert out["calls"] == ["stop-pid:41"]
    assert len(out["state"]["sign-edge"]["restarts"]) == 1
    assert m["fingerprintAfterFirst"].startswith("edge_main.py:")
    assert any("edge code changed on disk" in line for line in out["log"])
    # Same tree on the next tick: nothing to do.
    assert m["second"] is False
    # Edited again inside the 10-minute window: wait, and keep the OLD fingerprint on record so a
    # later tick retries the reload instead of forgetting the change.
    assert m["third"] is False
    assert m["fingerprintAfterThrottle"] == m["fingerprintAfterFirst"]


def test_edge_code_rule_leaves_an_unarmed_down_or_starting_edge_alone(tmp_path: Path):
    out = run_scenario("edge-code-leaves-unarmed-down-or-starting", tmp_path)
    assert out["calls"] == []
    assert out["markers"] == {"unarmed": False, "down": False, "starting": False, "fingerprint": ""}
    assert "sign-edge" not in out["state"]


def test_edge_fingerprint_ignores_office_modules_but_sees_edge_modules(tmp_path: Path):
    out = run_scenario("edge-code-fingerprint-skips-office-modules", tmp_path)
    assert out["markers"] == {"unchangedByOfficeModule": True, "changedByEdgeModule": True}
