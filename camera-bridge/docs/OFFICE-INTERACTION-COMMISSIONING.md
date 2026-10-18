# Office interaction wake — commissioning and truth boundary

This lane connects the office Eufy camera's semantic motion/person events to the existing
bounded office-audio -> transcript -> evidence-backed conversation pipeline.

It is deliberately split into proof rungs. Do not skip a rung and call the later one live.

## What this code does

- connects as a client to the existing authenticated Eufy SDK bridge;
- filters to the configured office camera serial and configured semantic events;
- defaults to EVENT-ONLY mode: receipts prove event delivery and nothing is recorded;
- optionally wakes one bounded office capture window;
- coalesces event bursts so five notifications do not launch five ffmpeg processes;
- uses the existing officeaudio/officepost path for capture, transcription, coverage, and post;
- prunes old local wav/transcript artifacts after the configured retention window.

It does NOT:
- log in to Eufy or create a second Eufy account session;
- identify a person;
- treat motion/person as proof of a customer, sale, repair, or service action;
- move PTZ;
- upload raw audio bytes to Nick's server;
- make the previously weak office microphone suddenly trustworthy.

## Rung 1 — prove bridge event receipt without recording

Install only the optional listener dependency in a separate environment:

```powershell
cd camera-bridge
py -3.12 -m venv .venv-office-wake
.\.venv-office-wake\Scripts\python.exe -m pip install --upgrade pip
.\.venv-office-wake\Scripts\python.exe -m pip install -r requirements-office-wake.txt
```

Point `EUFY_BRIDGE_URL` at the already-authenticated bridge WebSocket, for example the
bridge's `/ws` endpoint. Keep capture flags OFF.

Run one-event commissioning:

```powershell
.\.venv-office-wake\Scripts\python.exe -m vision.officewake --max-events 1 --ledger .\data\office\wake.jsonl
```

Then deliberately create motion/person activity in view of the office camera.

Success for this rung is a local `wake_decision` receipt with:

```json
{"action":"event_only","event":"personDetected","device_sn":"T8410P5225154105"}
```

A receipt proves only: bridge -> semantic event -> this process.

No receipt means STOP. Diagnose bridge auth/event delivery before touching audio or PTZ.

## Rung 2 — discover media from the bridge, not the old camera IP

Do not resurrect the historical `192.168.0.167` assumption.

The current upstream bridge exposes camera media separately from its WebSocket:
- `/snapshot/<serial>` for a JPEG still;
- `/stream/<serial>` for bridge live video;
- bundled go2rtc for RTSP/WebRTC/MSE/HLS.

Current upstream: https://github.com/mega-yfue/ha-eufy-sdk-bridge

Use the bridge/device response and go2rtc configuration on the SHOP machine to establish the
actual working audio/video source, then set that verified source as `OFFICE_MEDIA_URL`.
A URL written in a runbook is not proof; ffmpeg successfully reading the source is proof.

## Rung 3 — audio quality dry run

Before posting conversation episodes, keep the path dry:

```powershell
$env:OFFICE_INTERACTION_CAPTURE_ENABLED = "1"
$env:OFFICE_AUDIO_POLICY_ACK = "1"
$env:OFFICE_MEDIA_URL = "<verified media URL>"
$env:OFFICE_ACTIVE_SCHEDULE_JSON = '{"mon":"08:00-18:00"}'

.\.venv-office-wake\Scripts\python.exe -m vision.officewake --capture --dry-run --max-events 1
```

`OFFICE_AUDIO_POLICY_ACK` is an operator gate meaning the applicable recording-policy,
notice/consent, and counsel review has been completed. The code does not decide that question.

The schedule is intentionally explicit and local-time bounded. Empty schedule = capture blocked.

Inspect:
- capture succeeded;
- speech segmentation found real interactions;
- mean level was measured;
- transcript coverage;
- transcript coherence.

Historical measurement on the office camera was poor: a 90 second sample returned only about
37.4 seconds of transcript. The Nick's server already refuses fact extraction below 65%
coverage. Do not weaken that gate to make the feature look live.

## Secondary local wake fallback

Do not make production capture depend on Eufy semantic pushes alone. If the camera is media-healthy
but `motion` / `personDetected` events are absent, enable the local audio fallback only after the
normal capture/policy/schedule gates are already commissioned:

- `OFFICE_AUDIO_FALLBACK_ENABLED=1`
- `OFFICE_AUDIO_PROBE_SECONDS` controls the short live level probe.
- `OFFICE_AUDIO_PROBE_INTERVAL_SECONDS` controls probe cadence.
- `OFFICE_AUDIO_ACTIVITY_MEAN_DB` is the sustained mean dBFS threshold.
- `OFFICE_AUDIO_ACTIVITY_MAX_DB` is the peak dBFS threshold.
- `OFFICE_AUDIO_FALLBACK_COOLDOWN_SECONDS` prevents repeated fallback captures and starts after a fallback-triggered capture finishes.

Probe audio is not written to disk. A fallback wake requires both the mean and peak thresholds, so a
single door slam / ring / impact is less likely to start a recording. A threshold crossing only creates
an `audioActivity` wake; the existing bounded capture, local Whisper, transcript-coverage, retention,
and ingest gates still decide whether an episode is usable. Vendor motion/person events remain
preferred and can still wake the worker independently.

The installer fails closed unless `-AcknowledgeRecordingPolicy` is supplied. That switch is an
operator assertion that the applicable notice/consent and counsel review is complete; the installer
must never create that approval for the operator. Issue #2628 still records that policy review as open,
so production fallback activation remains blocked even though the technical path is dry-run proven.

A real NicksMax dry-run on 2026-09-29 proved the technical path with transcript coverage of 0.991 and
1.000. Those canaries are technical evidence only and are not a production-authorization receipt.

## Rung 4 — live conversation posting

Only after the dry run is intelligible and policy gates are satisfied:

- set `CAMERA_INGEST_KEY` on the shop capture process;
- keep `OFFICE_INTERACTION_CAPTURE_ENABLED=1`;
- run without `--dry-run`.

Raw audio remains local. The server receives the existing conversation-episode payload:
timed transcript segments, coverage, engine/latency, measured level, and a local `audioRef`
pointer. Evidence-backed facts and summaries remain subject to the existing coverage gate.

Default raw artifact retention in this sidecar is 24 hours. Tune with
`--retention-hours`; do not convert raw office audio into indefinite storage by accident.

## Rung 5 — diarization/transcription upgrade

Do not install WhisperX/pyannote into the canonical camera runtime merely because they are
useful. Put the improved speech lane in an isolated Python environment and measure it against
the same Nick's clips.

Speaker labels such as `SPEAKER_00` are grouping labels only. They are not identities.

Promotion criterion: materially better coverage and word/number fidelity on local shop clips,
especially tire sizes, prices, times, and vehicle details. A newer model name is not proof.

## PTZ stays separate

PTZ commissioning is a separate truth path:
1. bridge auth good;
2. office serial found;
3. device reports PTZ capability;
4. explicit control flag enabled;
5. send one bounded command;
6. receive `ptzNotify`;
7. verify the resulting frame/pose;
8. return to a calibrated home/preset.

Vehicle geometry must remain suppressed while the camera is moving and until SceneLock/home
pose is re-established. A successful command acknowledgement is not motor-movement proof.

## Claim states

- Code + unit tests merged: BUILT.
- Event-only receipt on the actual shop bridge: LIVE EVENT DELIVERY.
- Verified media read on shop LAN: LIVE MEDIA SOURCE.
- Intelligible dry-run transcript above quality gates: LIVE + QUALITY-PROVEN AUDIO.
- Posted episode visible in Nick's admin: WIRED END TO END.
- Reliable summaries over real shop days: LONG-HORIZON PROVEN.

Do not collapse those states into one "done".

## Watch — still frames with every episode (2026-10-02)

Operator decision: recording signs (visual + audio) are posted in the shop, and the office camera
should watch as well as listen.

How it runs:
- During each bounded capture window, `vision/officeframes.py` pulls a still from the bridge's
  `/snapshot/<serial>` route. It takes one at the start, one every `OFFICE_VISUAL_INTERVAL_SECONDS`
  (default 30), and one closing frame, up to `OFFICE_VISUAL_MAX_FRAMES` (default 6).
- Each frame is shrunk to 640 px wide.
- Each episode carries only the frames inside its own time span (at most 4).
- The nickstire server sends them to the vision model (Ollama Cloud first, Gemini fallback). It
  stores ONLY the resulting description in `conversation_episodes.visual`.
- Frames are never written to disk on NicksMax and never stored on the server.
- Each frame also carries `people`: an on-box person count (Intel `person-detection-0200`,
  OpenVINO, confidence >= 0.5). `null` means NOT MEASURED (no model, no openvino/cv2, load or
  inference failure, or opted out) and never means "nobody there"; a measured empty office is `0`.
- Fetch the model once on NicksMax from `camera-bridge/`: `python vision/fetch_models.py`
  (lands in `ov_models/`, sha256-verified). Override the path with `OFFICE_PERSON_MODEL_XML`;
  opt out with `OFFICE_PERSON_DETECT=0`. A load failure is printed once to stderr.

On by default. To turn it off:
- `OFFICE_VISUAL_ENABLED=0` on NicksMax (machine env; needs an elevated shell);
- or `OFFICE_VISUAL_ANALYSIS=0` on the nickstire Railway service.

Inert until migration `0140_conversation_episodes_visual` is applied (Admin -> Run migrations).
Until then the server accepts frames, drops them unanalyzed, and replies
`visualStatus: NOT_STORED_VISUAL_COLUMN_UNAVAILABLE`.

Proof rungs:
1. Ledger `capture_finished` shows `frames_captured > 0`.
2. The post reply shows `visualStatus: DONE`.
3. Admin -> Lot -> Counter conversations shows a "Saw:" line.

## Stills without a bridge: `OFFICE_VISUAL_SOURCE=rtsp` (2026-10-17, shop PC MECHANICS)

The shop PC reads the camera's direct RTSP `/live0` and has no Eufy bridge, so the default
`/snapshot/<serial>` path finds nothing and the lane runs with `OFFICE_VISUAL_ENABLED=0`.
`OFFICE_VISUAL_SOURCE=rtsp` makes each still one ffmpeg grab from the capture URL
(`OFFICE_AUDIO_SOURCE`) instead: video only (`-an`), one decoder thread, scaled to 640 px inside ffmpeg (no OpenCV needed),
10 s timeout, below-normal priority. A failed grab is a missed frame; audio never waits on it.
Unset or `bridge` keeps the NicksMax behaviour exactly.

`OFFICE_WHISPER_THREADS=<n>` passes `-t <n>` to whisper-cli. Unset keeps whisper's default
thread count.

Enable on the shop PC (operator step, admin PowerShell, about 5 minutes):

1. Copy `vision/officeframes.py`, `vision/officepost.py` and `vision/officewake.py` from this
   commit into `C:\NOURCITY\camera-bridge\vision\`.
2. Set the machine env:
   `[Environment]::SetEnvironmentVariable("OFFICE_VISUAL_SOURCE", "rtsp", "Machine")`,
   then the same for `OFFICE_VISUAL_ENABLED` = `1` and `OFFICE_WHISPER_THREADS` = `2`
   (the Ryzen 5 7520U has 4 cores; 2 leaves half for the front desk).
3. Restart: `Stop-ScheduledTask StateNour-OfficeIntelligence-ShopPC`, then `Start-ScheduledTask`
   with the same name.
4. Check the ledger: the `startup` row shows `visualSource: rtsp` and `whisperThreads: 2`; the next
   `capture_finished` shows `frames_captured > 0`.
5. Check prod: new `conversation_episodes` rows from `captureHost MECHANICS` still arrive with
   transcripts, and Admin -> Lot -> Counter conversations shows a "Saw:" line on them.

Not proven yet: whether the camera serves a second RTSP session (the still grab) while the audio
capture holds one. If audio episodes stop or `frames_captured` stays 0, roll back with
`OFFICE_VISUAL_ENABLED=0` and restart the task.

## Office camera heartbeat from the shop PC: `OFFICE_CAMERA_HEARTBEAT_URL` (2026-10-18)

Admin -> Lot reads the office tiles from one row, `camera_runtime.office`, filled by
`POST /api/camera/heartbeat`. Until now only the Eufy agent on NicksMax wrote it (it folds this
worker's status file into its own heartbeat). With the lane on MECHANICS and NicksMax offline,
the row aged out: "producer offline" and a days-old NICKSMAX conversation receipt, while
MECHANICS posted episodes fine.

`OFFICE_CAMERA_HEARTBEAT_URL` makes officewake post that heartbeat itself, every 30 s, from the
same process (no new task, no new install). It sends the conversation receipt (the same 22 keys
the Eufy agent forwards) and the RTSP media path: `mediaPlaneOk` true when an audio-level probe
measured levels in the last 120 s, false when the latest probe (under 120 s old) failed, omitted
otherwise; `lastMediaProofAt` is the last probe that measured levels. Auth, events, PTZ control
and home are not sent: nothing on the shop PC measures them, so they stay unknown. Unset keeps
today's behaviour exactly (NicksMax). `--dry-run` never posts a heartbeat.

Which producer wins (decided by the server, `cameraProducerAuthority`, no new rule):

- The shop PC posts as `p1-shop-office-<id>`; NicksMax's Eufy agent is `p2-nicksmax-<id>`.
- While the shop PC is fresh, a NicksMax heartbeat gets `200 {"accepted": false}` and changes
  nothing. They cannot fight over the row.
- If the shop PC stops, NicksMax takes the row on its own once the shop PC is 90 s silent.
- To hand the office back to NicksMax for good, clear `OFFICE_CAMERA_HEARTBEAT_URL` on the shop
  PC and restart its task.

Enable on the shop PC (operator step, admin PowerShell, about 3 minutes):

1. Copy `vision/officewake.py` from this commit into `C:\NOURCITY\camera-bridge\vision\`.
2. Set the machine env (the heartbeat reuses `CAMERA_INGEST_KEY`, already set for episodes):
   `[Environment]::SetEnvironmentVariable("OFFICE_CAMERA_HEARTBEAT_URL", "https://nickstire.org/api/camera/heartbeat", "Machine")`
3. Restart: `Stop-ScheduledTask StateNour-OfficeIntelligence-ShopPC`, then `Start-ScheduledTask`
   with the same name.
4. Check the ledger: the `startup` row shows `cameraHeartbeat: true`, followed by one
   `camera_heartbeat_ok` row, written only when the server reports the heartbeat accepted.
   A `camera_heartbeat_error` row names the cause (401 = key; `not accepted (owner ...)` =
   another producer owns the row).
5. Check Admin -> Lot: the office camera tile leaves "producer offline" within a minute and the
   Conversation intelligence tile shows `MECHANICS`.

What the tiles will say, and why it is the truth:

- Office camera: "unverified capabilities", not "healthy". The office profile requires Eufy auth,
  events, PTZ control and home proof, and the shop PC proves none of them. Expect ONE owner
  alert for that state change (office is a commissioned, paging camera).
- Conversation intelligence: whatever the worker reports. If `EUFY_BRIDGE_URL` points at a bridge
  that does not exist, that is `bridge retry` between captures.

Rollback: clear `OFFICE_CAMERA_HEARTBEAT_URL` and restart the task. The row then ages out to
"producer offline" again, which is the state before this change.
