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
import os
import re
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
    # On Windows, Windows PowerShell 5.1 first: it is what runs the supervisor on NicksMax, and its
    # file-sharing rules differ from pwsh 7's (the 2026-10-08 log outage happened only under 5.1).
    order = ("powershell.exe", "pwsh") if os.name == "nt" else ("pwsh", "powershell.exe", "powershell")
    exe = next((found for found in map(shutil.which, order) if found), None)
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
    block = text[text.index("if ($free -lt $diskFloorBytes)") : text.index("Invoke-DiskFloor ([double]")]
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
    heal = text.index("if (Heal-EdgeCode $armed $prodHealthy)")
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


def test_edge_code_rule_leaves_an_unarmed_or_down_edge_alone(tmp_path: Path):
    out = run_scenario("edge-code-leaves-unarmed-or-down-edge-alone", tmp_path)
    assert out["calls"] == []
    assert out["markers"] == {"unarmed": False, "down": False, "fingerprint": ""}
    assert "sign-edge" not in out["state"]


def test_edge_launcher_wrapper_does_not_shield_the_edge_from_a_code_change():
    # run-sign-rtsp-production.ps1 stays alive as the edge's parent for its whole life, so a
    # "launcher alive" guard would never let the rule fire (NicksMax 2026-10-08 07:41-07:50).
    text = source()
    heal = text[text.index("function Heal-EdgeCode") : text.index("function Get-OfficeStatus")]
    assert "$prodStarting" not in heal.split("{", 1)[1]
    assert "function Heal-EdgeCode([bool]$armed,[bool]$prodHealthy)" in text


def test_logger_falls_back_to_an_overflow_file_when_the_log_is_locked(tmp_path: Path):
    out = run_scenario("log-locked-falls-back", tmp_path)
    assert out["markers"]["overflowExists"] is True
    assert "while locked" in out["markers"]["overflowText"]
    assert "after unlock" not in out["markers"]["overflowText"]
    assert any("after unlock" in line for line in out["log"])
    assert not any("while locked" in line for line in out["log"])


# ---- writes that a reader cannot block ------------------------------------------------------------
# Witnessed 2026-10-08 on NicksMax: from 07:34 every Add-Content to the log failed; lines from 08:20
# on went to .overflow, and 07:34-08:20 are lost. The holder (Restart Manager) was Desktop
# Commander's node process, whose read handle shares Read, Write and Delete; Windows PowerShell 5.1's
# Add-Content opens without read sharing, so it refused to open beside ANY reader, while a
# FileStream sharing all three opened the same file. pwsh 6.2+ shares reads in Add-Content (PR #8091)
# and Linux .NET does not enforce read-sharing, so on CI the log probe passes for the old writer too;
# the text contracts below pin the writer there. The 5.1 receipts (this suite under powershell.exe on
# NicksMax, the old script and planted defects) are in the PR that added these tests (#2935).


def _code_lines() -> list[str]:
    return [line for line in source().splitlines() if not line.lstrip().startswith("#")]


def test_every_write_goes_through_the_shared_writer():
    code = "\n".join(_code_lines())
    for cmdlet in ("Add-Content", "Set-Content", "Out-File", "Tee-Object", "WriteAllText", "AppendAllText", "WriteAllLines"):
        assert cmdlet not in code, f"{cmdlet} is back: it refuses to open beside a reader on 5.1"
    # 5.1's aliases for the same cmdlets, used as commands
    assert not re.search(r"(?m)(^|[;{(|]\s*|^\s*)(ac|sc|tee)\s+[-$('\"]", code), "an ac/sc/tee alias is back"
    assert not re.search(r"\s>>?\s*\$", code), "a redirection writes with the cmdlet sharing rules"
    writer = re.search(r"function Write-SharedFile\b.*?\n\}", code, re.S)
    assert writer, "Write-SharedFile is gone"
    body = writer.group(0)
    # The share value AND the open that uses it: a stray [IO.FileShare]::Write in the constructor
    # beside an untouched $share line is exactly the open that failed on the box.
    assert re.findall(r"\$share\s*=\s*(.+)", body) == ["[IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete"]
    assert "[IO.FileStream]::new($path, $mode, [IO.FileAccess]::Write, $share)" in body
    # Nothing else opens a file for writing.
    opens = re.findall(r"\[IO\.(?:FileStream\]::new|File\]::Open)\(([^\n]*)", code)
    assert [o for o in opens if "Write" in o] == ["$path, $mode, [IO.FileAccess]::Write, $share)"], opens
    assert "Write-SharedFile $prodStartMarker" in code


def _top_level_index(code_lines: list[str], startswith: str) -> int:
    hits = [i for i, line in enumerate(code_lines) if line.startswith(startswith)]
    assert len(hits) == 1, f"{startswith!r} at {hits}"
    return hits[0]


def test_the_tick_restores_first_and_saves_the_ledger_last():
    lines = _code_lines()
    at = lambda s: _top_level_index(lines, s)
    restore = at("$restoreBlocked = Restore-Overflow")
    # After the lock and after every function it needs is defined (a call above its definition is
    # "not recognized" under Continue and the tick carries on without it), before anything logs.
    assert at("  $supervisorLockHandle = [IO.File]::Open(") < restore
    for definition in ("function Write-SharedFile", "function Log(", "function Restore-Overflow"):
        assert at(definition) < restore, definition
    assert restore < at("$state = Read-State")
    assert at("function Report-BlockedRestore") < at("Report-BlockedRestore $restoreBlocked")
    assert at("$nowEpoch = ") < at("Report-BlockedRestore $restoreBlocked")
    # The ledger is saved once, after the last heal, so every tick's restarts and port misses persist.
    assert at("Invoke-DiskFloor (") < at("Save-State")
    assert at("function Save-State") < at("Save-State")
    assert [line for line in lines if line.strip()][-1].startswith("if ($supervisorLockHandle)")


def test_the_log_is_written_beside_a_reader_that_shares_everything(tmp_path: Path):
    out = run_scenario("log-read-by-a-sharing-reader", tmp_path)
    assert out["markers"]["overflowExists"] is False
    assert any(line.endswith(" while read") for line in out["log"])


def test_stranded_overflow_lines_are_restored_into_the_log_in_order(tmp_path: Path):
    out = run_scenario("overflow-restored-into-log", tmp_path)
    log = out["log"]
    assert log[0] == "2026-10-08 07:34:08 last line before the lock"
    assert re.fullmatch(
        r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d NOTE restored 2 line\(s\) written 2026-10-08 08:20:14 \.\. "
        r"2026-10-08 18:51:13 to supervisor\.log\.overflow while this log could not be opened",
        log[1],
    ), log[1]
    assert log[2:4] == ["2026-10-08 08:20:14 ACTION first stranded", "2026-10-08 18:51:13 ACTION last stranded"]
    assert log[4].endswith(" after restore") and len(log) == 5
    assert out["markers"]["innerBom"] is False
    assert out["markers"]["leftovers"] in (None, [])


def test_a_restore_waits_for_a_locked_log_and_lands_each_line_once(tmp_path: Path):
    out = run_scenario("overflow-restore-waits-for-the-log", tmp_path)
    assert out["markers"]["restoringWhileLocked"] is True
    body = [line for line in out["log"] if " NOTE restored " not in line]
    notes = [line for line in out["log"] if " NOTE restored " in line]
    assert [line[20:] for line in body] == [
        "before", "stranded one", "stranded two", "queued while locked", "after",
    ], out["log"]
    assert [re.search(r"restored (\d+) line", n).group(1) for n in notes] == ["2", "1"]
    assert out["markers"]["leftovers"] in (None, [])


def test_a_pending_batch_held_by_a_reader_lands_exactly_once(tmp_path: Path):
    out = run_scenario("overflow-batch-held-by-a-reader-lands-once", tmp_path)
    assert out["markers"]["pendingAfterBlockedAppend"] == 1
    body = [line[20:] for line in out["log"] if " NOTE restored " not in line]
    assert body == ["before", "stranded one", "after"], out["log"]
    assert sum(" NOTE restored 1 line(s) " in line for line in out["log"]) == 1
    assert out["markers"]["leftovers"] in (None, [])


def test_a_restore_a_reader_keeps_refusing_is_reported_once_and_lands_later(tmp_path: Path):
    out = run_scenario("restore-blocked-is-reported", tmp_path)
    assert out["markers"]["why"], "the blocked restore returned no reason"
    assert out["markers"]["afterRelease"] in (None, ""), "the restore after release still failed"
    warns = [line for line in out["log"] if "WARN stranded log lines were not restored" in line]
    assert len(warns) == 1, out["log"]
    body = [line[20:] for line in out["log"] if " NOTE restored " not in line and " WARN " not in line]
    assert body == ["before", "stranded", "after"], out["log"]


def test_the_restart_ledger_is_saved_beside_a_reader_that_shares_everything(tmp_path: Path):
    out = run_scenario("state-write-beside-a-sharing-reader", tmp_path)
    assert out["markers"]["portMissesOnDisk"] == 2
    assert not any("WARN" in line for line in out["log"])


def test_a_ledger_that_cannot_be_saved_says_so(tmp_path: Path):
    out = run_scenario("state-write-failure-is-logged", tmp_path)
    assert any("WARN could not persist supervisor state" in line for line in out["log"]), out["log"]


def test_edge_fingerprint_ignores_office_modules_but_sees_edge_modules(tmp_path: Path):
    out = run_scenario("edge-code-fingerprint-skips-office-modules", tmp_path)
    assert out["markers"] == {"unchangedByOfficeModule": True, "changedByEdgeModule": True}


# ---- venv launcher pairs: one worker, two matching processes ------------------------------------
# Witnessed 2026-10-08 07:00-07:36 on NicksMax: the first dedupe pass killed the CHILD interpreter
# of every venv worker (launcher pid N, real interpreter pid N+1 with the same command line, born
# 50-360 ms apart), the launcher exited, the task went Ready, and the supervisor restarted the
# office worker and the Eufy agent every two minutes (14 restarts an hour each, ESCALATE fired).


def test_venv_launcher_and_its_child_are_one_worker_not_a_duplicate(tmp_path: Path):
    out = run_scenario("dedupe-venv-launcher-pair-is-one-worker", tmp_path)
    assert out["calls"] == [], out["log"]
    assert out["state"]["eufy-agent"]["portMisses"] == 0


def test_two_venv_trees_end_the_whole_newer_tree_and_keep_the_port_owner(tmp_path: Path):
    out = run_scenario("dedupe-two-venv-trees-ends-the-newer-tree", tmp_path)
    assert sorted(out["calls"]) == ["stop-pid:23", "stop-pid:24"], out["log"]
    assert all("keeping pid=21" in line for line in out["log"] if "duplicate" in line)


def test_office_venv_launcher_pair_is_left_alone(tmp_path: Path):
    out = run_scenario("office-venv-launcher-pair-not-deduped", tmp_path)
    assert out["calls"] == [], out["log"]


# ---- port-owner identity (Codex on #2920) and fingerprint only after a verified restart (Codex on #2925)
# Positive control (2026-10-08): with the harness knobs in place and the PRE-FIX supervisor, the
# three probes below went red (every port owner ended by image name alone; the fingerprint recorded
# after a refused stop and after a failed start) and the three text contracts failed; all green after.


def test_port_owner_kill_verifies_the_command_line_and_fails_closed():
    text = source()
    block = text[text.index("function Stop-PortOwner") : text.index("function Remove-DuplicateProcesses")]
    assert "[string[]]$needles" in block
    assert "no child specification to verify it against" in block
    assert "has no readable command line" in block
    assert "is not this task's child by command line" in block
    # Stop-TaskChildren hands the task's needles over; a port is never probed without them.
    stop_children = text[text.index("function Stop-TaskChildren") : text.index("function Kick-Task")]
    assert 'Stop-PortOwner $port ("{0} :{1} owner" -f $key,$port) $spec.Needles' in stop_children


def test_port_owner_identity_is_the_command_line_not_the_image_name(tmp_path: Path):
    out = run_scenario("port-owner-identity", tmp_path)
    assert out["calls"] == ["stop-pid:11"]
    log = "\n".join(out["log"])
    assert "pid=61 is not this task's child by command line" in log
    assert "pid=62 has no readable command line" in log
    assert "pid=12: no child specification to verify it against" in log


def test_an_unrelated_go2rtc_survives_a_bridge_restart(tmp_path: Path):
    # Codex on #2931: the go2rtc needle was the bare image, so the needle sweep in
    # Stop-TaskChildren ended every go2rtc on the host before the guarded port pass ran.
    out = run_scenario("unrelated-go2rtc-survives-bridge-restart", tmp_path)
    calls = out["calls"]
    assert _index(calls, "stop-pid:11") < _index(calls, f"start-task:{BRIDGE_TASK}")
    assert _index(calls, "stop-pid:12") < _index(calls, f"start-task:{BRIDGE_TASK}")
    # Same command line as the bridge's go2rtc, another install, holding a managed port.
    assert "stop-pid:63" not in calls
    # Unreadable: the sweep no longer ends what the port pass refuses to guess about.
    assert "stop-pid:62" not in calls
    assert ":8655 owner pid=63 is not this task's child by command line" in "\n".join(out["log"])


def test_an_unrelated_go2rtc_is_not_a_duplicate_of_the_bridges(tmp_path: Path):
    # With the bare-image needle, the bridge's go2rtc and an older unrelated one were two roots of
    # one worker, neither owning :3000, so every healthy tick ended the newer one: the bridge's.
    out = run_scenario("unrelated-go2rtc-is-not-a-duplicate", tmp_path)
    assert out["calls"] == []


# ---- the bridge's node, known by its own path (2026-10-08) --------------------------------------
# The node needle was any `node ... server.mjs` -- the go2rtc defect from #2931 in a second image.
# server.mjs is the commonest Node entry point and :3000 the commonest dev port, so any other project
# on this box would be ended on every bridge restart and swept as a "duplicate" on every healthy tick
# (none runs there today; the 2026-10-08 probe found only Desktop Commander's node processes).
# start-bridge-nicksmax.ps1 now passes server.mjs by its absolute path under StateNour\Eufy\, and
# that path is the needle. Positive control: against the any-server.mjs needle the first two probes
# and the text contract went red; the dedupe control passed on both, as a control must.


def test_an_unrelated_node_server_survives_a_bridge_restart(tmp_path: Path):
    out = run_scenario("unrelated-node-survives-bridge-restart", tmp_path)
    calls = out["calls"]
    assert _index(calls, "stop-pid:11") < _index(calls, f"start-task:{BRIDGE_TASK}")
    assert _index(calls, "stop-pid:12") < _index(calls, f"start-task:{BRIDGE_TASK}")
    # Another project's server.mjs holding :3000: neither the sweep nor the port pass ends it.
    assert "stop-pid:64" not in calls
    assert ":3000 owner pid=64 is not this task's child by command line" in "\n".join(out["log"])
    # A node server.mjs with no path is nobody's child -- the reason the launcher changed first.
    assert "stop-pid:65" not in calls


def test_an_unrelated_node_server_is_not_a_duplicate_of_the_bridges(tmp_path: Path):
    out = run_scenario("unrelated-node-is-not-a-duplicate", tmp_path)
    assert out["calls"] == []


def test_two_copies_of_the_bridge_node_are_still_one_too_many(tmp_path: Path):
    # Control: the tighter needle must not blind the dedupe to the case it exists for.
    out = run_scenario("two-bridge-nodes-are-still-duplicates", tmp_path)
    assert out["calls"] == ["stop-pid:14"]
    assert any("duplicate eufy-bridge pid=14; keeping pid=11" in line for line in out["log"])


def test_the_bridge_node_needle_names_the_eufy_install():
    text = source()
    spec = text[text.index("function Get-TaskChildSpec") : text.index("function Stop-TaskChildren")]
    node_needles = re.findall(r"'(\^node[^']*)'", spec)
    assert len(node_needles) == 1, node_needles
    assert r"\\StateNour\\Eufy\\" in node_needles[0]
    assert r"server\.mjs" in node_needles[0]


def test_every_kill_path_reads_one_process_identity():
    text = source()
    # Built once, in Get-ProcessIdentity; no kill path formats its own.
    assert "-f $p.Name,$p.CommandLine" in text
    assert "-f $_.Name,$_.CommandLine" not in text
    assert "-f $cim.Name,$cim.CommandLine" not in text
    matching = text[text.index("function Get-ProcessesMatching") : text.index("function Find-ProcessByCommand")]
    assert "Get-ProcessIdentity $_" in matching
    port_owner = text[text.index("function Stop-PortOwner") : text.index("function Remove-DuplicateProcesses")]
    assert "$identity = Get-ProcessIdentity $cim" in port_owner


def test_edge_fingerprint_is_recorded_only_after_the_stale_edge_is_gone():
    text = source()
    heal = text[text.index("function Heal-EdgeCode") : text.index("function Get-OfficeStatus")]
    stop = heal.index("Stop-ProcessesByCommand $edgeNeedle")
    verify = heal.index("$left = @(Get-ProcessesMatching $edgeNeedle)")
    record = heal.index("$e.fingerprint = $fp")
    assert stop < verify < record
    assert "fingerprint not recorded, retrying next tick" in heal


def test_edge_code_rule_keeps_the_old_fingerprint_when_the_stop_fails(tmp_path: Path):
    out = run_scenario("edge-code-stop-fails-keeps-old-fingerprint", tmp_path)
    m = out["markers"]
    assert m["first"] is False
    assert m["fingerprintAfterFailedStop"] == ""
    assert m["restartsAfterFailedStop"] == 0
    assert any("still running after stop (pid=41)" in line for line in out["log"])
    # The next tick, with the process killable, ends it and records the fingerprint.
    assert m["second"] is True
    assert m["fingerprintAfterSecond"].startswith("edge_main.py:")
    assert out["calls"] == ["stop-pid:41:refused", "stop-pid:41"]


def test_kick_task_reports_whether_it_started_and_the_office_rule_records_only_then():
    text = source()
    kick = text[text.index("function Kick-Task") : text.index("function Reclaim-Orphan")]
    assert "return $true" in kick and kick.count("return $false") == 2
    office = text[text.index("function Heal-OfficeWorker") : text.index("function Heal-EufyTask")]
    assert 'if (Kick-Task $officeTask "office-worker" "office worker code changed on disk; restarting to load it" $true 2) {' in office
    # Every other kick discards the flag, so no boolean leaks into the script's output stream.
    bare = [
        line for line in text.splitlines()
        if "Kick-Task " in line and "function Kick-Task" not in line and "[void](Kick-Task" not in line and "if (Kick-Task" not in line
    ]
    assert bare == []


def test_office_code_change_keeps_the_old_fingerprint_when_the_start_fails(tmp_path: Path):
    out = run_scenario("office-code-change-start-fails-keeps-old-fingerprint", tmp_path)
    assert out["markers"]["fingerprintAfterFailedStart"] == ""
    assert any("start FAILED" in line for line in out["log"])
    assert f"start-task:{OFFICE_TASK}" not in out["calls"]


# ---- the sign crop at dusk ------------------------------------------------------------------------
# Witnessed 2026-10-08 18:01-18:10: the relay stayed up while the solar sign camera sent no frames,
# and the supervisor restarted the crop 8 times in 9 minutes, then ESCALATEd "needs a human". A crop
# restart cannot make frames the camera is not sending: the crop now asks the relay's stack first.

SIGN = "rtsp://127.0.0.1:8555/sign"
RELAY = "rtsp://127.0.0.1:8554/live"


def test_a_dark_camera_does_not_restart_the_crop_and_says_so_once_an_hour(tmp_path: Path):
    out = run_scenario("crop-dark-upstream-at-night", tmp_path)
    assert out["markers"] == {"first": False, "second": False}
    assert not any(c.startswith("start-process:") for c in out["calls"]), out["calls"]
    assert out["calls"].count(f"probe:{RELAY}") == 2
    notes = [line for line in out["log"] if "sign camera sends no frames" in line]
    assert len(notes) == 1 and " NOTE " in notes[0] and "expected" in notes[0], out["log"]
    assert "sign-crop" not in out["state"], "a dark camera must not count as crop restarts"


def test_a_dark_camera_in_daylight_escalates_with_what_to_check(tmp_path: Path):
    out = run_scenario("crop-dark-upstream-in-daylight", tmp_path)
    assert out["markers"]["ready"] is False
    assert not any(c.startswith("start-process:") for c in out["calls"])
    assert any("ESCALATE sign camera sends no frames in DAYLIGHT" in line and "V380" in line for line in out["log"]), out["log"]


def test_a_broken_crop_beside_a_live_relay_is_restarted(tmp_path: Path):
    out = run_scenario("crop-broken-while-upstream-has-frames", tmp_path)
    starts = [c for c in out["calls"] if c.startswith("start-process:") and c.endswith("run-sign-crop.ps1")]
    assert len(starts) == 1, out["calls"]
    assert out["calls"].index(f"probe:{RELAY}") < out["calls"].index(starts[0])
    assert any("ACTION restart sign-crop" in line for line in out["log"])
    assert len(out["state"]["sign-crop"]["restarts"]) == 1


def test_a_healthy_crop_costs_no_relay_probe(tmp_path: Path):
    out = run_scenario("crop-healthy", tmp_path)
    assert out["markers"]["ready"] is True
    assert out["calls"] == [f"probe:{SIGN}"], out["calls"]


# ---- host scripts: drift ----------------------------------------------------------


def test_an_installed_host_script_that_differs_from_the_repo_is_reported_once_a_day(tmp_path: Path):
    out = run_scenario("host-script-drift", tmp_path)
    warns = [line for line in out["log"] if " WARN installed " in line]
    shim = [w for w in warns if "installed shim script" in w]
    crop = [w for w in warns if "installed crop script" in w]
    assert len(shim) == 2, warns  # once, then again a day later; never on the repeat within the day
    assert len(crop) == 1 and "missing" in crop[0], warns
    assert all("install-nicksmax-supervisor-host.ps1" in w for w in warns)


def test_the_tick_heals_the_crop_through_the_function_and_checks_drift_after_reading_state():
    lines = _code_lines()
    at = lambda s: _top_level_index(lines, s)
    assert at('Enter-Phase "sign-crop"') < at("$signFrameReady = Heal-SignCrop (Get-Date).Hour") < at("$directReady = ")
    assert at("try { Test-HostScriptDrift }") > at("$state = Read-State")
# ---- the tick ran past the loop's 45 s budget (2026-10-03..10-08) --------------------------------
# data\nicksmax-camera-supervisor-loop.ps1 (box-local) kills a tick at 45 s: 422 kills on NicksMax,
# 2026-10-03 to 10-08; 10-08's fell mostly at dawn (04:49-06:56) and dusk (19:22-20:54), the hours the
# solar sign camera drops and the relay and crop recover. A killed tick never reaches its Save-State,
# so its restarts and ESCALATE stamps were lost with it. Measured on the box 2026-10-08 21:05-21:10 ET
# as nourd, one call at a time at 76-100% CPU:
#   Get-ScheduledTask, any query          ~0.95 s each; a tick made 9 of them      ~8.5 s
#   Test-RtspFrame on a HEALTHY 8555/sign  5.8 s (up to 12 s when it fails); a recovery tick made 3
#   Select-String over relay-system.stderr.log (215 MB, ~18 MB/h of --debug) 2.5-2.7 s, every tick
#   Get-CimInstance Win32_Process          ~0.25 s each; ~7 per tick
# Summed, a healthy tick spent ~20 s on those calls alone; a crop recovery added two probes and went
# over. The slow-tick NOTE lines below are what will say which phase it really was, as SYSTEM.


def test_slow_tick_names_the_slow_phase_first(tmp_path: Path):
    out = run_scenario("slow-tick-names-the-slow-phase", tmp_path)
    notes = [line for line in out["log"] if " NOTE slow tick: " in line]
    assert len(notes) == 1, out["log"]
    m = re.search(r"NOTE slow tick: 37200 ms \(pid=\d+\); (.*)$", notes[0])
    assert m, notes[0]
    assert m.group(1).split(", ") == [
        "sign-crop 34000", "startup 1500", "task-list 1000", "ledger 500", "disk 100", "save 100",
    ]
    assert out["markers"]["breadcrumbLeft"] is False


def test_a_fast_tick_writes_nothing(tmp_path: Path):
    out = run_scenario("fast-tick-is-silent", tmp_path)
    assert out["log"] == []
    assert out["markers"]["breadcrumbLeft"] is False


def test_a_killed_tick_is_named_by_the_next_tick_once(tmp_path: Path):
    out = run_scenario("killed-tick-is-reported-by-the-next", tmp_path)
    assert out["markers"]["breadcrumbWhileRunning"] is True
    notes = [line for line in out["log"] if " NOTE slow tick: " in line]
    assert len(notes) == 1, out["log"]
    assert re.search(
        r"NOTE slow tick: pid=\d+ started \d\d:\d\d:\d\d did not finish: in sign-crop from 9000 ms; "
        r"before that task-list 7000, startup 1500, ledger 500$",
        notes[0],
    ), notes[0]
    assert out["markers"]["breadcrumbAfterReport"] is False


def test_every_phase_of_the_tick_is_timed_in_order():
    lines = _code_lines()
    phases = [line for line in lines if line.startswith("Enter-Phase ") or "{ Enter-Phase $et.Key;" in line]
    assert [p.split("#")[0].strip() for p in phases] == [
        'Enter-Phase "ledger"',
        'Enter-Phase "task-list"',
        'Enter-Phase "retired-tasks"',
        'Enter-Phase "office"',
        "foreach ($et in $eufyTasks) { Enter-Phase $et.Key; Heal-EufyTask $et }",
        'Enter-Phase "sign-relay"',
        'Enter-Phase "sign-mediamtx"',
        'Enter-Phase "sign-crop"',
        'Enter-Phase "sign-edge"',
        'Enter-Phase "disk"',
        'Enter-Phase "fallback"',
        'Enter-Phase "save"',
    ]
    at = lambda s: _top_level_index(lines, s)
    # The predecessor's breadcrumb is read before this tick's first boundary overwrites it.
    assert at("$restoreBlocked = Restore-Overflow") < at("Report-UnfinishedTick") < at('Enter-Phase "ledger"')
    assert at("Save-State") < at("Complete-Tick") < at("if ($supervisorLockHandle)")
    assert "$slowTickMs = 30000" in source()
    # Measured from process start: the loop's 45 s clock starts at Start-Process, not at line 1.
    assert "$tickStarted = [Diagnostics.Process]::GetCurrentProcess().StartTime" in source()


def test_a_tick_reads_the_task_list_once(tmp_path: Path):
    out = run_scenario("one-task-read-per-tick", tmp_path)
    assert out["markers"]["taskReads"] == ["list"]
    # The snapshot is not a blind spot: the retired task is still found and disabled.
    assert out["calls"] == [
        "stop-task:StateNour-Eufy-Watchdog-NicksMax",
        "disable-task:StateNour-Eufy-Watchdog-NicksMax",
    ]


def test_a_failed_task_list_read_falls_back_to_per_name_reads(tmp_path: Path):
    out = run_scenario("task-list-read-fails-falls-back-per-name", tmp_path)
    # Unknown is not absent: the Ready bridge is still found and started.
    assert out["calls"] == [f"start-task:{BRIDGE_TASK}"]
    assert out["markers"]["taskReads"] == ["list", f"name:{BRIDGE_TASK}", f"name:{AGENT_TASK}"]


def test_no_task_is_read_by_name_on_the_hot_path():
    text = source()
    code = "\n".join(_code_lines())
    by_name = re.findall(r"Get-ScheduledTask -TaskName [^\n]*", code)
    # Two left: the per-name fallback inside Get-Task, and the office re-read after a repoint.
    assert len(by_name) == 2, by_name
    retire = text[text.index("function Disable-RetiredTasks") : text.index('Enter-Phase "retired-tasks"')]
    assert "Get-Task $taskName" in retire


def test_relay_login_refusal_is_read_from_the_tail_only(tmp_path: Path):
    out = run_scenario("relay-login-refusal-reads-the-tail", tmp_path)
    assert out["markers"] == {"endsRefused": True, "refusedThenStreamed": False, "small": True, "missing": False}


def test_relay_stderr_is_read_only_while_the_relay_is_down():
    code = "\n".join(_code_lines())
    assert "Select-String" not in code
    assert (
        '$relayAuthHold = (-not $relayReady) -and ((Restarts-InLastMinutes "sign-relay" 30) -gt 0) '
        "-and (Test-RelayLoginRefused $relayErr)"
    ) in code


def test_the_edge_start_reuses_this_ticks_decoded_frame():
    # $directReady is (8554 open) AND $signFrameReady, a frame this tick decoded seconds earlier. The
    # start path probed it a third time (6-12 s) in exactly the recovery tick that ran out of budget.
    code = "\n".join(_code_lines())
    # The two 8555/sign probes are Heal-SignCrop's (the first look, and the re-check after a restart).
    assert code.count("Test-RtspFrame $signUrl") == 2
    assert 'Test-RtspFrame "rtsp://127.0.0.1:8555/sign"' not in code
    start = code[code.index("if ($armed) {") : code.index("function Invoke-DiskFloor")]
    assert "Test-RtspFrame" not in start
    assert "refusing early edge start" not in code


def test_a_restart_is_on_disk_before_the_tick_ends(tmp_path: Path):
    out = run_scenario("restart-saves-the-ledger-at-once", tmp_path)
    assert out["markers"]["restartsOnDisk"] == 1


# ---- the shim's fallback copy (2026-10-09) -------------------------------------------------------
# The box-local shim runs this file, or data\nicksmax-camera-supervisor.fallback.ps1 when it is missing
# or does not parse. Found on NicksMax 2026-10-08: that copy was dated 2026-09-29 08:23 and nothing
# refreshed it, so a half-finished pull would have rolled the supervisor back past every 10-07/10-08 fix.


def test_a_completed_tick_refreshes_a_stale_fallback(tmp_path: Path):
    out = run_scenario("fallback-refreshed-when-stale", tmp_path)
    m = out["markers"]
    assert m["text"] == "Write-Output 'v2'\n# the tick that ran\n"
    assert m["firstTimeText"] == m["text"]
    assert m["leftovers"] in (None, [])
    refreshed = [line for line in out["log"] if "ACTION refreshed the fallback supervisor copy" in line]
    assert len(refreshed) == 2, out["log"]


def test_an_identical_fallback_is_not_rewritten(tmp_path: Path):
    out = run_scenario("fallback-identical-is-left-alone", tmp_path)
    assert out["markers"]["untouched"] is True
    assert out["log"] == []


def test_the_fallback_never_takes_a_text_that_does_not_parse(tmp_path: Path):
    out = run_scenario("fallback-never-takes-an-unparseable-text", tmp_path)
    assert out["markers"]["text"] == "Write-Output 'v1'"
    assert out["log"] == []


def test_a_failed_fallback_write_keeps_the_old_copy_and_says_so_once(tmp_path: Path):
    out = run_scenario("fallback-write-failure-keeps-the-old-copy", tmp_path)
    assert out["markers"]["text"] == "Write-Output 'v1'"
    warns = [line for line in out["log"] if "WARN could not refresh the fallback supervisor copy" in line]
    assert len(warns) == 1, out["log"]
    assert not [line for line in out["log"] if "ACTION refreshed" in line]


def test_the_tick_keeps_the_fallback_it_ran_from():
    lines = _code_lines()
    at = lambda s: _top_level_index(lines, s)
    assert '$fallbackPath = Join-Path $root "data\\nicksmax-camera-supervisor.fallback.ps1"' in source()
    # The text is read as the tick starts (what ran), and written only after the last heal.
    assert at("try { $tickSource = Read-SharedText $PSCommandPath } catch {}") < at('Enter-Phase "ledger"')
    assert at('Enter-Phase "fallback"') < at("Update-FallbackCopy $tickSource $fallbackPath") < at('Enter-Phase "save"')
    update = source()[source().index("function Update-FallbackCopy") :]
    update = update[: update.index("\n}\n") + 3]
    # Staged then swapped: a truncated fallback is worse than a stale one.
    assert "Write-SharedFile $staged $text" in update
    assert "[IO.File]::Replace($staged, $target, [NullString]::Value)" in update
    assert "ParseInput($text" in update


# ---- a sign-crop restart that restarts the crop (2026-10-09) -------------------------------------
# run-sign-crop.ps1 holds .sign-crop.lock for its ffmpeg's whole life; a second launcher exits on it.
# The supervisor started one beside a live but undecodable crop and counted it: sign-crop-status.log
# shows "SKIP duplicate sign crop; lock held" at 18:03:25 and 18:09:07 on 2026-10-08, beside
# "restart sign-crop" lines and "ESCALATE sign-crop restarted 7 times in an hour".


def test_a_crop_restart_ends_the_old_crop_before_starting_one(tmp_path: Path):
    out = run_scenario("crop-restart-ends-the-old-crop", tmp_path)
    calls = out["calls"]
    start = _index(calls, r"start-process:C:\Users\nourd\NicksMax\lab\v380-cloud-relay\run-sign-crop.ps1")
    assert _index(calls, "stop-pid:72") < start  # the crop ffmpeg
    assert _index(calls, "stop-pid:71") < start  # its launcher, which holds the lock
    # A publisher into 8554, a frame probe of 8555/sign, an unreadable ffmpeg, the MediaMTX launcher.
    for neighbour in (73, 74, 75, 76):
        assert f"stop-pid:{neighbour}" not in calls, calls
    assert out["markers"]["started"] is True
    assert len(out["state"]["sign-crop"]["restarts"]) == 1


def test_a_crop_restart_waits_for_the_old_launchers_lock(tmp_path: Path):
    out = run_scenario("crop-restart-waits-for-the-lock", tmp_path)
    m = out["markers"]
    assert m["startedWhileHeld"] is False
    assert m["restartsWhileHeld"] == 0  # a launcher that would only exit on the lock is not a restart
    assert m["startedAfter"] is True
    assert sum(c.startswith("start-process:") for c in out["calls"]) == 1
    assert any("WARN sign-crop restart held" in line for line in out["log"]), out["log"]


def test_the_crop_is_only_started_through_its_restart():
    code = "\n".join(_code_lines())
    assert not [line for line in code.splitlines() if "Start-Process" in line and "$cropLauncher" in line]
    crop = code[code.index('Enter-Phase "sign-crop"') : code.index('Enter-Phase "sign-edge"')]
    assert "if (-not (Restart-SignCrop $cropLauncher $cropLock)) { return $false }" in crop
    assert "Start-Process" not in crop
