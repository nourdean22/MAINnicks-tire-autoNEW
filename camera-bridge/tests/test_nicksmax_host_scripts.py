"""The NicksMax supervisor's HOST scripts: the loop, the shim and the launchers that run from outside
the tracked tree (data\\, lab\\, AppData). Until 2026-10-09 they existed only on the box, where they
drifted: each wrote with Windows PowerShell 5.1's Add-Content, which fails beside any open reader
(the supervisor log's outage that day), and each launcher deleted its previous run's logs at start,
so a crashed process's own log was gone once it was restarted. The repo copies are canonical now,
scripts/nicksmax/install-nicksmax-supervisor-host.ps1 installs them, and the tick reports drift.

Text contracts pin the writer everywhere (Linux .NET does not enforce Windows read-sharing, so a
behaviour probe of the old writer passes there); the shim, the loop and the installer are run for
real under PowerShell.
"""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
NICKSMAX = ROOT / "scripts" / "nicksmax"
SUPERVISOR = NICKSMAX / "nicksmax-camera-supervisor.ps1"
LOOP = NICKSMAX / "nicksmax-camera-supervisor-loop.ps1"
SHIM = NICKSMAX / "nicksmax-camera-supervisor-shim.ps1"
EDGE = NICKSMAX / "run-sign-rtsp-production.ps1"
CROP = NICKSMAX / "run-sign-crop.ps1"
EUFY = NICKSMAX / "start-bridge-nicksmax.ps1"
MEDIAMTX = NICKSMAX / "run-mediamtx-sign.ps1"
INSTALLER = NICKSMAX / "install-nicksmax-supervisor-host.ps1"
HOST_SCRIPTS = [LOOP, SHIM, EDGE, CROP, EUFY, MEDIAMTX]


def _pwsh() -> str:
    order = ("powershell.exe", "pwsh") if os.name == "nt" else ("pwsh", "powershell.exe", "powershell")
    exe = next((found for found in map(shutil.which, order) if found), None)
    assert exe, "host-script probes require PowerShell 7 or Windows PowerShell"
    return exe


def _run(script: Path, *args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(
        [_pwsh(), "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(script), *args],
        capture_output=True, text=True, timeout=timeout,
    )


def _code(path: Path) -> str:
    return "\n".join(line for line in path.read_text(encoding="utf-8").splitlines() if not line.lstrip().startswith("#"))


def _function(path: Path, name: str) -> str:
    m = re.search(rf"^function {re.escape(name)}\b.*?^\}}", path.read_text(encoding="utf-8"), re.S | re.M)
    assert m, f"{name} missing from {path.name}"
    return m.group(0)


# ---- text contracts ------------------------------------------------------------------------------


@pytest.mark.parametrize("script", HOST_SCRIPTS + [INSTALLER], ids=lambda p: p.name)
def test_no_host_script_writes_with_the_cmdlets_that_refuse_readers(script: Path):
    code = _code(script)
    for cmdlet in ("Add-Content", "Set-Content", "Out-File", "Tee-Object"):
        assert cmdlet not in code, f"{script.name} writes with {cmdlet}"
    assert not re.search(r"(?m)(^|[;{(|]\s*|^\s*)(ac|sc|tee)\s+[-$('\"]", code), f"{script.name} uses an ac/sc/tee alias"


@pytest.mark.parametrize("script", [LOOP, SHIM, EDGE, CROP, MEDIAMTX], ids=lambda p: p.name)
def test_every_copy_of_the_shared_writer_is_the_supervisors(script: Path):
    assert _function(script, "Write-SharedFile") == _function(SUPERVISOR, "Write-SharedFile")


@pytest.mark.parametrize("script,logs", [(EDGE, ("$outLog", "$errLog")), (CROP, ("$outLog", "$errLog")), (EUFY, ("$stdout", "$stderr"))], ids=lambda x: getattr(x, "name", ""))
def test_launchers_keep_the_previous_runs_logs(script: Path, logs: tuple[str, str]):
    code = _code(script)
    for log in logs:
        assert not re.search(rf"Remove-Item\s+[^\n]*\{log}\b", code), f"{script.name} still deletes {log}"
        assert f"Rotate-Log {log}" in code, f"{script.name} does not rotate {log}"
        assert code.index(f"Rotate-Log {log}") < code.index("Start-Process"), "logs must rotate before the process starts"
    assert ".prev" in _function(script, "Rotate-Log")


def _host_pairs(text: str, key_from: str, key_to: str) -> dict[str, tuple[str, str]]:
    pairs = {}
    for name, a, b in re.findall(rf'Name = "([\w-]+)";\s*{key_from} = ([^;]+);\s*{key_to} = ([^}}]+)\}}', text):
        pairs[name] = (a.strip(), b.strip())
    return pairs


def test_the_installer_and_the_drift_check_name_the_same_scripts():
    installer = _host_pairs(INSTALLER.read_text(encoding="utf-8"), "From", "To")
    supervisor = _host_pairs(SUPERVISOR.read_text(encoding="utf-8"), "Repo", "Installed")
    assert set(installer) == set(supervisor) == {"loop", "shim", "edge", "crop", "mediamtx", "eufy-bridge"}
    for name, (repo_from, _installed) in installer.items():
        repo_file = repo_from.strip('"')
        assert repo_file in supervisor[name][0], (name, repo_file, supervisor[name])
        assert (NICKSMAX / repo_file).exists(), repo_file
    # Same installed file on both sides (the installer builds it with Join-Path, the tick with a literal).
    for name in installer:
        assert re.findall(r'"([\w.-]+\.ps1)"', installer[name][1])[-1] in supervisor[name][1], name


# ---- the shim, run for real ----------------------------------------------------------------------


def _shim(tmp_path: Path, repo_tick: str | None, fallback: str | None) -> tuple[subprocess.CompletedProcess, list[str]]:
    repo = tmp_path / "repo-tick.ps1"
    fb = tmp_path / "fallback.ps1"
    log = tmp_path / "supervisor.log"
    if repo_tick is not None:
        repo.write_text(repo_tick, encoding="utf-8")
    if fallback is not None:
        fb.write_text(fallback, encoding="utf-8")
    r = _run(SHIM, "-RepoTick", str(repo), "-FallbackTick", str(fb), "-LogPath", str(log))
    lines = log.read_text(encoding="utf-8").splitlines() if log.exists() else []
    return r, lines


def test_the_shim_runs_a_repo_tick_that_parses_and_passes_its_exit_code(tmp_path: Path):
    r, log = _shim(tmp_path, "Set-Content -LiteralPath (Join-Path $PSScriptRoot 'ran-repo') -Value x\nexit 3\n", "exit 9\n")
    assert r.returncode == 3, r.stderr
    assert (tmp_path / "ran-repo").exists()
    assert log == []


def test_the_shim_falls_back_and_escalates_when_the_repo_tick_does_not_parse(tmp_path: Path):
    r, log = _shim(tmp_path, "function broken {\n", "Set-Content -LiteralPath (Join-Path $PSScriptRoot 'ran-fallback') -Value x\nexit 5\n")
    assert r.returncode == 5, r.stderr
    assert (tmp_path / "ran-fallback").exists()
    assert len(log) == 1 and log[0].endswith("ESCALATE repo supervisor missing or unparseable; running fallback copy"), log


def test_the_shim_escalates_and_fails_when_there_is_nothing_to_run(tmp_path: Path):
    r, log = _shim(tmp_path, None, None)
    assert r.returncode == 1
    assert len(log) == 1 and "no fallback copy exists" in log[0], log


# ---- the loop, one pass for real ------------------------------------------------------------------


def _loop(tmp_path: Path, supervisor_body: str, timeout_seconds: int) -> list[str]:
    sup = tmp_path / "tick.ps1"
    sup.write_text(supervisor_body, encoding="utf-8")
    log = tmp_path / "loop.log"
    r = _run(LOOP, "-Supervisor", str(sup), "-LogPath", str(log), "-IntervalSeconds", "0",
             "-TimeoutSeconds", str(timeout_seconds), "-MaxIterations", "1", "-PowerShellExe", _pwsh(), timeout=90)
    assert r.returncode == 0, r.stderr
    return log.read_text(encoding="utf-8").splitlines()


def test_the_loop_reports_a_tick_that_fails(tmp_path: Path):
    log = _loop(tmp_path, "exit 7\n", 30)
    assert log[0].split(" ", 2)[2].startswith("START supervisor loop pid=")
    assert log[1].endswith("WARN supervisor iteration exit=7"), log


def test_the_loop_ends_a_tick_that_runs_past_its_timeout(tmp_path: Path):
    log = _loop(tmp_path, "Start-Sleep -Seconds 20\n", 2)
    assert any("WARN supervisor iteration timed out after 2s; killed pid=" in line for line in log), log


def test_the_loop_is_quiet_for_a_tick_that_succeeds(tmp_path: Path):
    log = _loop(tmp_path, "exit 0\n", 30)
    assert len(log) == 1 and "START supervisor loop" in log[0], log


# ---- the installer, run for real -----------------------------------------------------------------


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _install_root(tmp_path: Path) -> dict[str, Path]:
    root = tmp_path / "camera-bridge"
    src = root / "scripts" / "nicksmax"
    src.mkdir(parents=True)
    for f in (LOOP, SHIM, EDGE, CROP, EUFY, MEDIAMTX):
        shutil.copy(f, src / f.name)
    (root / "data").mkdir()
    crop_dir = tmp_path / "relay"
    eufy_dir = tmp_path / "eufy"
    crop_dir.mkdir()
    eufy_dir.mkdir()
    (root / "data" / "nicksmax-camera-supervisor.ps1").write_text("# old shim\n", encoding="utf-8")
    return {"root": root, "src": src, "crop": crop_dir, "eufy": eufy_dir}


def _installer(paths: dict[str, Path], *extra: str) -> subprocess.CompletedProcess:
    return _run(INSTALLER, "-Root", str(paths["root"]), "-CropDir", str(paths["crop"]), "-EufyDir", str(paths["eufy"]), *extra)


def test_the_installer_installs_every_host_script_and_keeps_what_it_replaced(tmp_path: Path):
    paths = _install_root(tmp_path)
    shim_target = paths["root"] / "data" / "nicksmax-camera-supervisor.ps1"
    r = _installer(paths)
    assert r.returncode == 0, r.stdout + r.stderr
    targets = {
        "nicksmax-camera-supervisor-loop.ps1": paths["root"] / "data" / "nicksmax-camera-supervisor-loop.ps1",
        "nicksmax-camera-supervisor-shim.ps1": shim_target,
        "run-sign-rtsp-production.ps1": paths["root"] / "data" / "run-sign-rtsp-production.ps1",
        "run-sign-crop.ps1": paths["crop"] / "run-sign-crop.ps1",
        "run-mediamtx-sign.ps1": paths["crop"] / "run-mediamtx-sign.ps1",
        "start-bridge-nicksmax.ps1": paths["eufy"] / "start-bridge-nicksmax.ps1",
    }
    for source, target in targets.items():
        assert _sha(target) == _sha(paths["src"] / source), source
    backups = list((paths["root"] / "data").glob("nicksmax-camera-supervisor.ps1.bak-*"))
    assert len(backups) == 1 and backups[0].read_text(encoding="utf-8") == "# old shim\n"
    assert r.stdout.count("UPDATED ") == 6 and "6 updated, 0 refused" in r.stdout, r.stdout
    assert not list(tmp_path.rglob("*.new")), "a staged copy was left behind"

    again = _installer(paths)
    assert again.returncode == 0 and again.stdout.count("UNCHANGED ") == 6, again.stdout


def test_the_installer_check_changes_nothing(tmp_path: Path):
    paths = _install_root(tmp_path)
    r = _installer(paths, "-Check")
    assert r.returncode == 0 and r.stdout.count("WOULD UPDATE ") == 6, r.stdout
    assert (paths["root"] / "data" / "nicksmax-camera-supervisor.ps1").read_text(encoding="utf-8") == "# old shim\n"
    assert not (paths["crop"] / "run-sign-crop.ps1").exists()


def test_the_installer_refuses_a_source_that_does_not_parse(tmp_path: Path):
    paths = _install_root(tmp_path)
    (paths["src"] / "nicksmax-camera-supervisor-shim.ps1").write_text("function broken {\n", encoding="utf-8")
    r = _installer(paths)
    assert r.returncode == 1, r.stdout
    assert "REFUSED shim" in r.stdout and "does not parse" in r.stdout
    assert (paths["root"] / "data" / "nicksmax-camera-supervisor.ps1").read_text(encoding="utf-8") == "# old shim\n"
    assert r.stdout.count("UPDATED ") == 5, r.stdout


# ---- the MediaMTX launcher, run for real -----------------------------------------------------------
# A fake MediaMTX (this Python, running a script that prints lines) stands in for the binary; the
# launcher's job is the log, so the log is what these assert.


def _mediamtx(tmp_path: Path, lines: int, cap: int, rc: int = 0) -> subprocess.CompletedProcess:
    fake = tmp_path / "fake-mediamtx.py"
    fake.write_text(
        "import sys\n"
        f"for i in range({lines}):\n"
        "    print(f'2026/10/30 10:44:29 INF [RTSP] [conn 127.0.0.1:{i:05d}] opened ' + 'x' * 60, flush=True)\n"
        f"sys.exit({rc})\n",
        encoding="utf-8",
    )
    return _run(MEDIAMTX, "-Root", str(tmp_path), "-Exe", sys.executable, "-Config", str(fake), "-CapBytes", str(cap))


def test_the_mediamtx_log_never_grows_past_its_cap(tmp_path: Path):
    r = _mediamtx(tmp_path, lines=300, cap=4000)
    assert r.returncode == 0, r.stdout + r.stderr
    live = tmp_path / "mediamtx-sign.log"
    prev = tmp_path / "mediamtx-sign.log.prev"
    line_max = 120
    assert live.exists() and prev.exists()
    assert live.stat().st_size <= 4000 + line_max and prev.stat().st_size <= 4000 + line_max
    # The newest line is in the live file; nothing older than one cap survives.
    assert "[conn 127.0.0.1:00299]" in live.read_text(encoding="utf-8")
    assert "[conn 127.0.0.1:00000]" not in prev.read_text(encoding="utf-8") + live.read_text(encoding="utf-8")


def test_the_mediamtx_log_trims_an_oversized_file_at_start_and_keeps_a_small_one(tmp_path: Path):
    live = tmp_path / "mediamtx-sign.log"
    live.write_bytes(b"old\n" * 5000)  # 20 KB, past a 4 KB cap
    r = _mediamtx(tmp_path, lines=1, cap=4000)
    assert r.returncode == 0, r.stdout + r.stderr
    assert (tmp_path / "mediamtx-sign.log.prev").stat().st_size == 20000
    assert live.read_text(encoding="utf-8").count("\n") == 1

    small = tmp_path / "small"
    small.mkdir()
    (small / "mediamtx-sign.log").write_text("kept\n", encoding="utf-8")
    r = _mediamtx(small, lines=1, cap=4000)
    assert r.returncode == 0
    assert (small / "mediamtx-sign.log").read_text(encoding="utf-8").startswith("kept\n")
    assert not (small / "mediamtx-sign.log.prev").exists()


def test_the_mediamtx_launcher_passes_the_exit_code_through(tmp_path: Path):
    r = _mediamtx(tmp_path, lines=2, cap=4000, rc=3)
    assert r.returncode == 3, r.stdout + r.stderr


def test_the_mediamtx_launcher_fails_when_the_binary_is_missing(tmp_path: Path):
    r = _run(MEDIAMTX, "-Root", str(tmp_path), "-Exe", str(tmp_path / "no-mediamtx.exe"), "-Config", str(tmp_path / "x.yml"))
    assert r.returncode == 2, r.stdout + r.stderr
    assert "FAIL MediaMTX binary missing" in (tmp_path / "mediamtx-sign.log").read_text(encoding="utf-8")
