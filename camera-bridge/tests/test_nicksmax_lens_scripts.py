"""Counter prep (2026-10-21): the lens-selectable crop, the one-command lens stills and the
unarmed inside launcher.

The crop is the live outside car counter's only feed, so the load-bearing test here is that the
DEFAULT crop is today's ffmpeg command, argument for argument. Every probe runs the real script
under Windows PowerShell with -PrintArgs (or against a closed port), so nothing here starts
ffmpeg, opens a lock on NicksMax paths, or reads a secret.
"""
from __future__ import annotations

import socket
import subprocess
from pathlib import Path

import pytest

from test_nicksmax_host_scripts import NICKSMAX, SUPERVISOR, _pwsh

CROP = NICKSMAX / "run-sign-crop.ps1"
STILLS = NICKSMAX / "grab-sign-lens-stills.ps1"
INSIDE = NICKSMAX / "run-inside-rtsp.ps1"
PRODUCTION = NICKSMAX / "run-sign-rtsp-production.ps1"

#: run-sign-crop.ps1's ffmpeg arguments at db623127c, verbatim. The default must stay this list.
TODAY_CROP_ARGS = [
    "-hide_banner",
    "-loglevel", "warning",
    "-use_wallclock_as_timestamps", "1",
    "-fflags", "+genpts+discardcorrupt",
    "-rtsp_transport", "tcp",
    "-timeout", "5000000",
    "-i", "rtsp://127.0.0.1:8554/live",
    "-an",
    "-vf", "crop=1920:1080:0:1080,scale=640:360,fps=4,setpts=N/(4*TB)",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "zerolatency",
    "-pix_fmt", "yuv420p",
    "-g", "8",
    "-keyint_min", "8",
    "-sc_threshold", "0",
    "-fps_mode", "cfr",
    "-f", "rtsp",
    "-rtsp_transport", "tcp",
    "rtsp://127.0.0.1:8555/sign",
]


def _run(script: Path, *args: str) -> subprocess.CompletedProcess:
    # cwd = the script's folder: a stray relative write lands where a test can see it.
    return subprocess.run(
        [_pwsh(), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(script), *args],
        capture_output=True, text=True, timeout=60, cwd=str(script.parent),
    )


def _lines(r: subprocess.CompletedProcess) -> list[str]:
    assert r.returncode == 0, r.stdout + r.stderr
    return [line for line in r.stdout.splitlines() if line != ""]


def _closed_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.mark.parametrize("script", [CROP, STILLS, INSIDE], ids=lambda p: p.name)
def test_every_script_parses_under_windows_powershell(script: Path):
    probe = ("$e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile('%s',[ref]$null,[ref]$e); "
             "if ($e.Count) { $e | ForEach-Object { $_.Message }; exit 1 }; 'PARSED'") % str(script)
    r = subprocess.run([_pwsh(), "-NoProfile", "-NonInteractive", "-Command", probe],
                       capture_output=True, text=True, timeout=60)
    assert r.returncode == 0 and "PARSED" in r.stdout, r.stdout + r.stderr


# ---- 1. lens-selectable crop ----------------------------------------------------------------------
def test_the_default_crop_is_todays_command_argument_for_argument():
    """The supervisor starts the crop with no arguments; that start must not change."""
    assert _lines(_run(CROP, "-PrintArgs")) == TODAY_CROP_ARGS


@pytest.mark.parametrize("lens,y", [("top", 0), ("middle", 1080), ("bottom", 2160)])
def test_each_lens_crops_its_own_band_and_changes_nothing_else(lens: str, y: int):
    got = _lines(_run(CROP, "-Lens", lens, "-PrintArgs"))
    want = [a.replace("crop=1920:1080:0:1080,", f"crop=1920:1080:0:{y},") for a in TODAY_CROP_ARGS]
    assert got == want


def test_an_unknown_lens_is_refused_rather_than_cropping_something():
    r = _run(CROP, "-Lens", "left", "-PrintArgs")
    assert r.returncode != 0
    assert "crop=" not in r.stdout
    # Name the refusal: a script that dies for any other reason (a missing drive) also exits non-zero.
    assert "does not belong to the set" in r.stdout + r.stderr, r.stdout + r.stderr


def _absent_drive() -> str:
    for letter in "QZYXWVU":
        if not Path(f"{letter}:\\").exists():
            return letter
    raise AssertionError("no unused drive letter to stand in for a host without C:")


def _on_a_host_without_c(script: Path, tmp_path: Path) -> Path:
    """The script with every C:\\ path moved to a drive that does not exist. Linux CI has no C:
    drive, and PowerShell's Join-Path throws on a missing drive, so this is the CI host on
    Windows. -PrintArgs and the refusal path must survive it."""
    copy = tmp_path / script.name
    copy.write_text(script.read_text(encoding="utf-8").replace("C:\\", f"{_absent_drive()}:\\"), encoding="utf-8")
    return copy


def test_print_args_and_refusals_never_touch_the_hosts_drives(tmp_path: Path):
    assert _lines(_run(_on_a_host_without_c(CROP, tmp_path), "-PrintArgs")) == TODAY_CROP_ARGS
    inside = _on_a_host_without_c(INSIDE, tmp_path)
    r = _run(inside, "-PrintArgs")
    assert r.returncode == 2 and "REFUSE inside edge" in r.stdout, r.stdout + r.stderr
    cal = tmp_path / "calib-inside.json"
    cal.write_text("{}", encoding="utf-8")
    args = _lines(_run(inside, "-SourceUrl", "rtsp://127.0.0.1:8556/inside", "-Calibration", str(cal), "-PrintArgs"))
    assert args[args.index("--mode") + 1] == "shadow"
    # On Linux a "C:\...\x.log" path is a legal FILE NAME in the working directory; the refusal's
    # log line must not create one there.
    assert sorted(p.name for p in tmp_path.iterdir()) == sorted([CROP.name, INSIDE.name, cal.name])


def test_the_status_log_names_the_lens_and_keeps_todays_words_for_the_default():
    text = CROP.read_text(encoding="utf-8")
    assert 'Log ("START {0}-lens crop proxy with wallclock timestamp normalization" -f $Lens)' in text


def test_the_supervisors_crop_identity_still_matches_every_lens():
    """Restart-SignCrop finds the old crop by its command line; a lens change must not hide it."""
    needle = None
    for line in SUPERVISOR.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("'^ffmpeg(\\.exe)?"):
            needle = line.strip().rstrip(",").strip("'")
    assert needle, "the supervisor's ffmpeg crop needle moved"
    import re
    for lens in ("top", "middle", "bottom"):
        args = _lines(_run(CROP, "-Lens", lens, "-PrintArgs"))
        command = "ffmpeg.exe " + " ".join(args)
        assert re.search(needle, command), (lens, command)


# ---- 2. lens stills -------------------------------------------------------------------------------
def test_the_stills_read_8554_once_and_write_the_stack_and_three_full_size_lenses(tmp_path: Path):
    args = _lines(_run(STILLS, "-OutRoot", str(tmp_path), "-PrintArgs"))
    joined = " ".join(args)
    assert args.count("-i") == 1 and args[args.index("-i") + 1] == "rtsp://127.0.0.1:8554/live"
    for crop in ("crop=1920:1080:0:0", "crop=1920:1080:0:1080", "crop=1920:1080:0:2160"):
        assert crop in joined
    outs = [a for a in args if a.endswith(".jpg")]
    assert [Path(a).name for a in outs] == ["stack.jpg", "top.jpg", "middle.jpg", "bottom.jpg"]
    assert all(Path(a).parent.parent == tmp_path for a in outs), "one dated folder under -OutRoot"
    assert args.count("-frames:v") == 4


def test_the_stills_never_touch_the_crop_its_port_or_the_edge():
    text = STILLS.read_text(encoding="utf-8")
    for forbidden in ("8555", "Stop-Process", "run-sign-crop", "sign-crop.lock", "edge_main", "Restart-"):
        assert forbidden not in text, forbidden


def test_the_stills_write_four_pictures_and_print_the_folder_when_the_relay_serves(tmp_path: Path):
    """Positive control for the refusal below: same script, a listening port and a stand-in
    ffmpeg that writes whatever .jpg it is handed."""
    fake = tmp_path / "fake-ffmpeg.ps1"
    # `exit 0` sets $LASTEXITCODE the way ffmpeg.exe does; without it the script reads null and fails.
    fake.write_text("foreach ($a in $args) { if ([string]$a -like '*.jpg') { Set-Content -LiteralPath $a -Value 'x' } }\n"
                    "exit 0\n", encoding="utf-8")
    out = tmp_path / "out"
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        s.listen(1)
        port = s.getsockname()[1]
        r = _run(STILLS, "-SourceUrl", f"rtsp://127.0.0.1:{port}/live", "-OutRoot", str(out), "-Ffmpeg", str(fake))
    assert r.returncode == 0, r.stdout + r.stderr
    folder = Path(next(line for line in r.stdout.splitlines() if line.startswith("STILLS ")).split(" ", 1)[1])
    assert folder.parent == out
    assert sorted(p.name for p in folder.iterdir()) == ["bottom.jpg", "middle.jpg", "stack.jpg", "top.jpg"]


def test_the_stills_refuse_plainly_when_8554_is_not_serving(tmp_path: Path):
    port = _closed_port()
    r = _run(STILLS, "-SourceUrl", f"rtsp://127.0.0.1:{port}/live", "-OutRoot", str(tmp_path))
    assert r.returncode != 0
    assert f"not serving on 127.0.0.1:{port}" in (r.stdout + r.stderr)
    assert list(tmp_path.iterdir()) == [], "nothing is written when there is nothing to read"


# ---- 5. inside launcher (unarmed) -----------------------------------------------------------------
def test_the_inside_launcher_refuses_without_its_source_and_calibration(tmp_path: Path):
    cal = tmp_path / "calib-inside.json"
    cal.write_text("{}", encoding="utf-8")
    for args in ([], ["-SourceUrl", "rtsp://127.0.0.1:8556/inside"], ["-Calibration", str(cal)],
                 ["-SourceUrl", "rtsp://127.0.0.1:8556/inside", "-Calibration", str(tmp_path / "missing.json")]):
        r = _run(INSIDE, *args, "-PrintArgs")
        assert r.returncode != 0, args
        assert "REFUSE" in (r.stdout + r.stderr), args
        assert "edge_main.py" not in r.stdout, args


def test_the_inside_launcher_runs_camera_inside_in_shadow_and_never_production(tmp_path: Path):
    cal = tmp_path / "calib-inside.json"
    cal.write_text("{}", encoding="utf-8")
    args = _lines(_run(INSIDE, "-SourceUrl", "rtsp://127.0.0.1:8556/inside", "-Calibration", str(cal), "-PrintArgs"))
    assert args[args.index("--camera") + 1] == "inside"
    assert args[args.index("--mode") + 1] == "shadow"
    assert args[args.index("--calibration") + 1] == str(cal)
    assert "production" not in " ".join(args).lower()
    assert "rtsp://127.0.0.1:8556/inside" not in args, "the URL travels in an env var, never on the command line"


def test_the_inside_launcher_has_its_own_lock_logs_and_progress_lease():
    inside, prod = INSIDE.read_text(encoding="utf-8"), PRODUCTION.read_text(encoding="utf-8")
    for name in (".nicksmax-sign-production.lock", "edge-NicksMaxSignProduction", ".nicksmax-sign-production.progress",
                 "nicksmax-sign-production.sqlite"):
        assert name in prod and name not in inside, name
    assert "nicksmax-inside" in inside


def test_the_inside_launcher_is_registered_nowhere():
    for path in NICKSMAX.glob("*.ps1"):
        if path != INSIDE:
            assert "run-inside-rtsp" not in path.read_text(encoding="utf-8"), path.name
