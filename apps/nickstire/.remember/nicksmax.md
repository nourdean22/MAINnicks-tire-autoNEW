# NicksMax camera authority — current handoff (2026-09-28)

NicksMax is a lightweight Windows edge/admin/recovery node. It is intentionally not a second Railway scheduler or heavy compute host.

## Production camera role

LIVE VERIFIED on 2026-09-28:
- NicksMax is the active production host for the Nick's `sign` camera-processing lane.
- The V380 desktop GUI is not required and was not running during final verification.
- Native V380 cloud relay listens on `0.0.0.0:8554`.
- FFmpeg consumes `rtsp://127.0.0.1:8554/live`, crops the SHOPSIGN middle lens, scales to 640x360 at 4 fps, and publishes to MediaMTX.
- MediaMTX exposes the cropped sign stream at `rtsp://127.0.0.1:8555/sign`.
- `edge_main.py` runs the production OpenVINO vehicle detector against that RTSP stream using `calib-nicksmax-sign-rtsp.json` (SHA256 `67F719CC875DEE8B0EFF9B246428CE9840530FB0921FA9BCC1FFB8803D502258`).
- The normal interactive `NicksMaxCameraSupervisorUser` task is disabled.
- The production supervisor and camera process tree run in Windows Session 0.
- Legacy WGC/V380-watchdog and shadow-candidate tasks remain disabled; do not restore them as production dependencies.

## Independence / self-heal receipts

A destructive commissioning check killed the old Session-1 production edge tree while the user supervisor was disabled. The Session-0 supervisor recreated:
- production wrapper PID lineage beginning at 18:27:11 ET,
- Python/OpenVINO edge processes at 18:27:12 ET,
- a fresh `START authoritative RTSP sign producer` receipt at 18:27:12 ET.

Railway production then accepted the restarted producer's camera heartbeats:
- 22:27:38Z: `sign seq=1 accepted state=HEALTHY`
- 22:28:08Z: seq=2 HEALTHY
- 22:28:38Z: seq=3 HEALTHY
- after locking Windows: 22:29:38Z seq=5, 22:30:08Z seq=6, 22:30:38Z seq=7, 22:31:08Z seq=8 — all HEALTHY.

This proves the camera lane survives without the V380 GUI, without the interactive user supervisor, and while Windows is locked.

## Evidence boundary / remaining proof

- A full Windows reboot **after** the SYSTEM-supervisor cutover has not been observed. The remote-control layer blocked the restart command. Treat cold-boot persistence as configured-but-not-yet-live-proven.
- Do not claim a reboot receipt until a later session observes the machine boot, the Session-0 supervisor start, and fresh Railway camera heartbeats without logging into the desktop.
- C: had about 2.53 GB free (6.3%) at closeout. Camera logs/DBs were small; active worktrees were the largest obvious reclaim candidates and were deliberately left untouched.

## Operating rules

- Keep the direct cloud -> 8554 -> crop -> 8555/sign -> OpenVINO path as the production architecture.
- Do not reopen V380 GUI/WGC as a hidden production dependency.
- Keep one authoritative `sign` producer; do not re-enable the user supervisor while the SYSTEM lane is healthy.
- Preserve the production calibration and camera ledgers unless a measured recommissioning explicitly replaces them.
- NicksMax stays lightweight: camera edge/admin/recovery work is allowed; Railway scheduler duplication, Docker/LLM stacks, Frigate-class workloads, and broad worktree duplication are not.
- Consumer Windows ESU enrollment remains a separate workstation/security task.

Workstation detail: `docs/operations/NICKSMAX-WORKSTATION-2026-09-27.md`.

## Office Eufy production role - 2026-09-28 identity correction

LIVE VERIFIED:
- The operational Office Eufy camera is **NICKS EUCLID** (`T8410P5225154105`, T8410C). It is commissioned and `PRODUCTION`, not SHADOW.
- `Moes Euclid Office` (`T8410P522517180B`) is the old/legacy shared camera. It may remain visible in the Eufy account, but it is not the production Office heartbeat, media, event, PTZ, wake, fallback-registry, or home-verifier target.
- NicksMax is the Office Eufy runtime authority. NattyNour's old OfficeHealth producer remains disabled.
- NicksMax runs `StateNour-Eufy-Bridge-NicksMax`, `StateNour-Eufy-Agent-NicksMax`, and `StateNour-Eufy-Watchdog-NicksMax`.
- Eufy bridge HTTP/WS is `127.0.0.1:3000`; go2rtc uses API `1984`, RTSP `8654`, WebRTC `8655`. V380 sign keeps `8554/8555`.
- The live bridge enumerates NICKS EUCLID with video, snapshot, motion, person detection, RTSP, PTZ, audio and arming capabilities.
- After the NicksMax agent target was corrected to `T8410P5225154105`, the event stream received `streamState` for that serial and the first two agent cycles completed with 0 errors.
- A forced NICKS EUCLID media probe read real media successfully: `mediaPlaneOk=true`, `lastMediaProofAt=2026-09-29T00:20:11.894521+00:00`.
- Nick production accepted the corrected producer at 00:19:11Z as `office seq=1 state=UNVERIFIED_CAPABILITIES`, explicitly transitioning `MEDIA_DEGRADED -> UNVERIFIED_CAPABILITIES`; heartbeats continued through at least `seq=16` at 00:28:15Z.


## Office Intelligence production runtime - 2026-09-28/29

LIVE ON NICKSMAX:
- NICKS EUCLID (`T8410P5225154105`) now has a headless local recording route at `http://127.0.0.1:3000/record/T8410P5225154105`; live probing returned H.264 + AAC 16 kHz mono. Chrome and the Windows mic are not production dependencies.
- `StateNour-OfficeIntelligence-NicksMax` is the sole Office interaction worker and was commissioned as SYSTEM / AtStartup. The durable Eufy installer owns Bridge + Agent only and disables legacy `StateNour-Eufy-OfficeWake` if found.
- Current worker receipt advances continuously as `workerOk=true`, `state=OFF_HOURS`, source `eufy-office`, host `NICKSMAX`, STT `whisper-cli.exe`, queue 0, failures 0. Ledger confirms event-bridge connection.
- The live Eufy agent reads that receipt and folds it into the authoritative `office` heartbeat. Local payload proof: `p2-nicksmax-*`, `PRODUCTION`, source generation `T8410P5225154105`, with worker state/source/host/STT/queue/failure facets.
- A real 15-second camera-audio commissioning run wrote a valid ~447 KB WAV but correctly produced zero episodes because the room was quiet (~ -71.8 dBFS mean, -50.6 dBFS peak; speech gate -35 dB).
- Eufy remains on 3000/1984/8654/8655 and V380 remains on 8554/8555.

BUILT/TESTED, NOT YET A PRODUCTION ADMIN RECEIPT:
- Branch `feat/office-intelligence-20260929` adds the unified Admin -> Lot -> Office intelligence cockpit, conversation-worker facets on `camera_runtime.office`, episode provenance, and evidence-gated summary ingest.
- Focused verification passed 76 Office tests, 38 Eufy tests, 63 Nick/Admin tests; latest duplicate-owner cleanup passed 12/12 Eufy installer tests.
- Still required after deploy: one real in-hours person/motion -> bounded capture -> Whisper -> evidence/coverage -> conversation episode -> visible Admin summary. Do not claim a production customer summary before that receipt exists.

Health boundary:
- NICKS EUCLID media is healthy. The old Moes P2P timeout / `hubStatus=false` evidence is historical and must not be used to describe current Office health.
- `UNVERIFIED_CAPABILITIES` is currently honest: fresh semantic-event proof, PTZ/control receipt, and calibrated-home proof are still unknown in the current producer process.
- A `streamState` event proves media activity but is not a substitute for a real motion/person semantic-event receipt.
- Do not reuse Moes home references, PTZ receipts, calibration artifacts, or P2P-failure evidence for NICKS EUCLID. Camera-specific proofs must be recommissioned against `T8410P5225154105`.
