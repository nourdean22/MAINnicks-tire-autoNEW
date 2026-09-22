# Bringing the producer up on the always-on shop PC

Written 2026-09-10 for the session standing up the shop computer. Everything below was
measured that day from a laptop sitting on the shop LAN, not inferred.

**This supersedes a durable note that said no shop PC exists.** It did not; the "Core Ultra
shop PC" in older memory was the operator's laptop. A permanently-on machine on the camera
subnet changes the plan: the producer stops being something that runs while somebody is
physically at the shop.

---

## 1. What the network actually looks like

Measured 2026-09-10 ~15:20 ET from `192.168.0.174`. Nine devices answered.

| IP | MAC | open TCP | what it is |
|---|---|---|---|
| `.1` | `80-82-fe-23-70-67` | 80, 443 | Fios router |
| `.151`, `.152` | locally-administered | — | phones with MAC randomisation |
| **`.154` SHOPINSIDE** | `1c-4e-a2-c2-ce-37` | **8800 only** | V380, locked |
| **`.155` SHOPSIGN** | `1c-4e-a2-c2-f0-6d` | **8800 only** | V380, locked |
| `.156` | `00-1d-a9-69-73-bf` | — | |
| `.157` | `00-23-24-b5-e3-2f` | — | |
| `.159` | `30-13-8b-c8-2b-f6` | 80, 443, 8080 | nginx appliance |
| `.160` | `58-02-05-16-5f-c8` | — | |
| `.167` | `90-bf-d9-0a-31-fd` | 554, 9000 | RTSP server, **no auth** — but 404 on all 14 standard camera paths, so not a camera |

**Read the two lines that matter.**

- **Being on the shop LAN is necessary but not sufficient.** Both cameras expose *only* port
  8800 — the V380 local/P2P transport. No 554 (RTSP), no 8899 (ONVIF), no HTTP. This
  reproduces exactly what the 2026-09-08 shop probe recorded, so nothing has regressed and
  **the `ceshi.ini` SD-card unlock is still the gate** for a direct stream. Until then the
  only way in is the V380 desktop client's window, which is what the producer captures.
- **`.155` is already live.** The standing operator TODO to "reserve .154/.155" is about a
  DHCP *reservation* in the Fios router, not about bringing them up. Worth doing so the
  addresses cannot move under a binding, but it is not blocking.

`scripts/test-rtsp.ps1` re-runs this fingerprint. Two traps: it takes **many minutes per
host** (it is not ffprobe — a single ffprobe with the script's own arguments returns in
0.1s; cause not yet found), and passing `-Cameras @{...}` from pwsh to `powershell -File`
**stringifies the hashtable** and the script dies. Run it in-session with
`& .\scripts\test-rtsp.ps1`.

---

## 2. Bring the box up

```powershell
# 1. Python 3.14 + the pinned deps. OpenVINO 2026.3.1 runs on 3.14 with CPU+GPU+NPU.
pip install -r camera-bridge/requirements.txt

# 2. Detector weights, pinned by sha256 -- never fetch them by hand.
python -m vision.fetch_models

# 3. Preflight. Run this BEFORE anything else; every check replaces a question you would
#    otherwise answer by watching the lot for ten minutes and guessing.
powershell -File scripts/doctor-edge-runtime.ps1
```

`doctor` probes the ingest routes it claims to reach: **401/403 is the only PASS** (route
deployed *and* guard live), 404 fails loudly, and 2xx/400 fails as a security finding because
the guard let an anonymous caller past. What it deliberately does **not** prove is that the
key we hold is the *right* key — that needs a write, so it stays a WARN.

---

## 3. Run it durably

Use the installer, not a bare `python edge_main.py`. It registers a Scheduled Task that
survives logon, and **the wrapper line it writes is the real production command line** — a
flag that has no route through the installer is off in production no matter how well it is
tested. `tests/test_installer_flag_drift.py` fails when that happens.

```powershell
powershell -File scripts/install-edge-runtime.ps1 -DryRun     # print the plan, install nothing
powershell -File scripts/install-edge-runtime.ps1
```

> `-DryRun` is the INSTALLER's ("show me the plan"). The producer's own dry-run is
> `-ProducerDryRun`, renamed after the two collided and an install *preview* would have baked
> `--dry-run` into the installed wrapper.

**It must run at logon on the interactive desktop, never as SYSTEM.** The WGC capture lane
reads a window; Windows services run in Session 0, which has no desktop at all.

The command line the producer has been running under, verbatim, for reference:

```
python edge_main.py --config config.yaml --camera sign
  --scene-atlas data/scene-atlas --scene shop-left
  --calibration data/calib-shop-left.json
  --model ov_models/vehicle-detection-0200/FP16/vehicle-detection-0200.xml
  --device AUTO --hard-cases data/hard-cases --hard-case-episodes both
  --trajectories data/trajectories.sqlite --fps 4 --dry-run
```

---

## 4. The three things that will bite

**`--dry-run` gates StateNour ONLY. The shop lane still POSTs to production.** This is the
one to read twice. A producer started "just to see if it works" is writing real rows against
the shop's live counters unless you have separately arranged otherwise.

**The V380 client window is the sensor.** The scene locator finds SHOPSIGN by *appearance*
against `data/scene-atlas`, so the client must be showing the right channel, and the window
must not be resized or re-ordered casually — a layout change breaks track continuity by
design (the epoch folds into `source_generation`). Two things it handles on its own, so do
not "fix" them: it captures an **occluded** window fine (WGC reads the surface, not the
screen), and it **un-minimises itself** — `capture.restore_if_minimized` detects the
no-surface case and restores the window by title *without stealing focus*, because a
minimised window renders nothing for WGC to read.

**Never run a package install inside a junctioned worktree.** `worktree-setup.ps1` NTFS-
junctions every `node_modules`; an install inside one offers to wipe the shared tree every
other worktree points at, and the prompt defaults to yes. On a fresh box that has its own
clone this does not apply — it applies the moment you make a worktree.

---

## 5. What the producer now records, and where to look

All of this landed 2026-09-10 and needs a producer restart to take effect.

| where | what |
|---|---|
| `data/hard-cases/<stamp>-<TRIGGER>/` | JPEG clip + `case.json` + a replayable MCAP episode. **9 of 16 triggers are wired**; `TRIGGERS_WIRED` is the honest list and is now gated in BOTH directions |
| `data/trajectories.sqlite` → `track_points` | ground points at 1 Hz, for measuring the lot polygon. **Skips every suppressed frame**, so it is structurally blind to stillness — do not try to reconstruct track lifetimes from it |
| `data/trajectories.sqlite` → `track_deaths` | every track the tracker retires, with the tolerance it actually applied. This is the denominator the re-acquisition rate never had |
| `python -m vision.museum --corpus data/hard-cases` | replay the corpus; five verdicts, and an empty corpus exits 2 rather than reading as "everything is fine" |
| `python -m vision.trajectory` | PROPOSES a lot polygon from real traffic. It never applies one, and it refuses to write over a `calib*` filename |

`reacquisition_rates()` in `vision/trajectory.py` answers "do we lose more cars in the
settling window than once they are parked?" — and returns `verdict: "insufficient"` below 30
deaths in a band rather than a number somebody will quote.

---

## 6. Facts worth not rediscovering

- **`stationary` is load-bearing and its threshold is THREE seconds**, not 25. visitd treats
  it as an OR-branch past its own dwell gates (`visitd/state_machine.py:750,752`): it skips
  the 10s candidate gate outright and cuts confirmation from 45s to 20s. Read those two lines
  before changing anything that feeds stillness.
- **The lot polygon must be INSET.** `geometry.py:89` makes the polygon alone carry the
  crossing when there is no portal, and neither fixed lens sees the driveway. Fit it to the
  full drivable region and there is no *outside* left: cars appear already inside, never
  cross, and the shop records zero arrivals under a perfectly green producer.
- **A moved PTZ matched its stored reference at 158 inliers** — nine times the floor — with a
  0.81 ratio and 1.33px reprojection. Confidently, precisely wrong. Only an independent
  signal caught it (the quad sat 623px from the detected live pane). Fit quality alone will
  never tell you the binding is wrong.
- **A CI job that is `failure` with zero failing steps is a killed run**, not a test failure:
  merging to main recomputes every open PR's merge ref. Rerun, do not debug. Read it with
  `gh api repos/<o>/<r>/actions/jobs/<id>/logs` — `gh run view --log-failed` prints nothing
  for that shape.

---

## 7. "V380 logs in but shows no cameras"

Hit on 2026-09-10 while moving the client from the laptop to the shop PC: the app reported
*invalid login* while apparently logged in, and after signing out on the laptop and in on the
shop PC it showed no cameras at all.

**Check the network before the account.** Login is a CLOUD call and will succeed from any
internet connection; the device list needs to reach the cameras. A machine on a different
router, on guest Wi-Fi, or on a separate VLAN logs in perfectly and then shows nothing, which
is exactly the observed symptom.

```powershell
# 1. Is this machine even on the camera subnet? It must answer 192.168.0.x.
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object { $_.IPAddress -notlike '127.*' } |
  Select-Object IPAddress, InterfaceAlias | Format-Table -AutoSize

# 2. Can it actually reach the cameras? 8800 is the ONLY port either one exposes.
foreach ($ip in '192.168.0.154','192.168.0.155') {
  $c = New-Object System.Net.Sockets.TcpClient
  try { $r = $c.BeginConnect($ip, 8800, $null, $null)
        $ok = $r.AsyncWaitHandle.WaitOne(1000, $false) -and $c.Connected } catch { $ok = $false }
  '{0} 8800 reachable={1}' -f $ip, $ok
  $c.Close()
}
```

Read the two results together:

| IP is `192.168.0.x` | 8800 reachable | what it means |
|---|---|---|
| no | — | **This is the problem.** Wrong network segment; the app can never enumerate the cameras |
| yes | no | On the subnet but blocked — check the Windows firewall profile and whether the NIC is on a guest/isolated SSID |
| yes | yes | Network is fine; it is the app or the account. Sign in on a machine known to work to confirm the cameras themselves are up |

**"Invalid login" while logged in is usually a stale cached session, not a concurrency
limit.** Quit the app completely -- including the tray icon, not just the window -- before
signing in again. Do not start by assuming the account is locked to one machine.

### What the producer does when the client goes away

Measured the same day. Closing the V380 window does not leave a half-blind producer running:
WGC stops delivering a surface, `check_stall` sees no frame at all, and the producer EXITS
after `StallExitSeconds` (default 180s). Observed exactly that -- last frame 16:49:34, process
gone by 16:52.

That is the designed behaviour: a source delivering NO FRAME is a process problem a restart
fixes, unlike a frozen or looping camera, which is a VISION problem the pipeline reports as
DEGRADED_VISION without restarting. **A producer started by hand does not come back on its
own** -- only the Scheduled Task from §3 restarts it, which is the main reason to install it
rather than run `python edge_main.py` in a terminal.

---

## 8. The office conversation capture (added 2026-09-22)

A second, independent producer on the same box. The lot cameras answer "what vehicles were
here"; this one answers "what was actually said at the counter", which is the half no camera
can see.

**It is a different pipeline with a different privacy posture, so it is deliberately not
folded into `edge_main.py`.** The audio never leaves this machine: it is transcribed locally
and only the TEXT is posted. `conversation_episodes.audioRef` stores a path, never a
recording.

### Install it

One command, once, as Administrator. Read the key on this machine so it never travels:

```powershell
railway run -s MAINnicks-tire-auto -- printenv CAMERA_INGEST_KEY
cd C:\NOURCITY\camera-bridge\scripts
.\install-office-capture.ps1 -SourceUrl "rtsp://<user>:<pass>@192.168.0.167/live0" -IngestKey "<paste>"
```

It verifies every prerequisite BEFORE changing anything -- Administrator, Python >= 3.9,
`tzdata`, `ffmpeg`, the whisper binary, and a live `ffprobe` proving the camera really carries
an audio stream -- and names the fix for each. `-WhatIf` shows the changes without making them.

The ingest key and the RTSP URL go into the MACHINE environment, not the task's arguments: a
scheduled task's command line is readable by any user via `schtasks /query /v`, and the camera
credentials are inside that URL.

### Hours

08:00-18:00 America/New_York, **every day including weekends** (operator's choice, 2026-09-22).
Outside that window the stream is never opened -- the office is a private room after hours.

The hours live in ONE place, `vision/officeloop.py`, not in the Task Scheduler trigger. The
task runs at boot and the loop decides its own hours, so there is no second schedule to keep in
sync with the first. To change them, pass `--open` / `--close` when registering, or edit
`DEFAULT_OPEN` / `DEFAULT_CLOSE`.

### The three things that will bite

| Symptom | Cause | Fix |
|---|---|---|
| Task starts and dies instantly; log says `no tz database entry` | **Windows ships no system timezone database.** stdlib `zoneinfo` cannot resolve `America/New_York` without the `tzdata` package -- measured here 2026-09-22 on Python 3.14.4 | `python -m pip install tzdata`. There is deliberately NO fallback to a fixed UTC offset: it would work most of the year and then shift the shop's hours by an hour on each DST day, which is the failure hardest to notice |
| Every episode lands `SKIPPED` with no facts | The transcriber is missing or broken and posting empty transcripts | Check the log for `transcriber_missing` / `transcriptError`. An empty transcript WITH an error stores as FAILED; one WITHOUT an error means the room was genuinely quiet. Those are different findings and the row keeps them apart |
| Episodes store but `factsStored` is always 0 | Transcript coverage below 65% | **This is the gate working, not a bug.** See below |

### Why most episodes will refuse facts at first

Measured 2026-09-22: a 90-second office sample transcribed on this machine produced text for
**37.4s of 90s**. The 50s that came back empty were NOT quiet -- they carried normal
conversational energy (-16.7 to -31.2 dB against -21 to -36 dB for the windows that did
transcribe), and the 44% that did return was semantically incoherent.

So the server refuses to extract facts below 65% coverage. A summariser fed a gappy transcript
does not produce a thin summary; it produces a fluent, confident, WRONG one -- and at a tire
shop a confident wrong "205/55 R16" is worse than no number at all.

Nothing needs changing as the audio improves: coverage rises, facts start flowing, no code
change. If coverage stays low for several days, the answer is a microphone at the counter, not
a threshold edit.

### Verify one window by hand

```powershell
cd C:\NOURCITY\camera-bridge\vision
python officepost.py --source-url $env:NICK_OFFICE_RTSP --out-dir C:\nick-office-audio --seconds 60 --dry-run
```

`--dry-run` transcribes and prints the payload without posting. Drop it to post for real; the
reply carries `transcriptStatus`, `coverage` and `dropped`.

**Calibrate the silence threshold from the real room** rather than trusting the default, and do
it during a BUSY stretch -- a calibration run in a quiet hour derives its threshold from room
tone, and the capture then splits on nothing:

```powershell
python officeaudio.py --source-url $env:NICK_OFFICE_RTSP --out-dir C:\nick-office-audio --calibrate --calib-samples 12 --calib-spacing 60
```

It exits 5 and proposes nothing when the samples are too few or too flat to separate speech
from the floor. That refusal is the correct outcome, not an error to work around.
