# NicksMax workstation + camera authority handoff — 2026-09-28

## Identity / bounded role

NicksMax is Nour's older Intel MacBook Air running Windows 10 (MacBookAir7,2 class, i5-5350U, 8 GB RAM, ~40 GB BOOTCAMP C:). It is a lean always-on edge/admin/recovery node.

Authority boundary:
- NicksMax is authoritative for the bounded Nick's `sign` camera edge and the commissioned Office Eufy interaction/health lane.
- Railway remains authority for the cloud application, database, schedulers, and general production orchestration.
- NicksMax is still not a Docker/WSL-heavy, local-LLM, Frigate, or general production-worker host.

## Current camera truth — LIVE VERIFIED

- V380 desktop GUI is not required and was absent during final verification.
- Native V380 cloud relay listens on `0.0.0.0:8554`.
- FFmpeg consumes the three-lens RTSP stack, crops the SHOPSIGN middle lens, scales it to 640x360 at 4 fps, and publishes to MediaMTX.
- Production sign stream: `rtsp://127.0.0.1:8555/sign`.
- OpenVINO `edge_main.py` consumes that stream in production mode.
- Active calibration: `calib-nicksmax-sign-rtsp.json`, SHA256 `67F719CC875DEE8B0EFF9B246428CE9840530FB0921FA9BCC1FFB8803D502258`.
- The interactive `NicksMaxCameraSupervisorUser` task is disabled.
- Production supervisor and edge processes run in Windows Session 0.
- Legacy GUI/WGC/watchdog/shadow paths stay disabled; do not restore them as production dependencies.

## Recovery and independence receipts

- With the user supervisor disabled, the old Session-1 production edge tree was killed.
- Session 0 recreated the production wrapper at 18:27:11 ET and Python/OpenVINO edge processes at 18:27:12 ET.
- Railway accepted the restarted producer at 22:27:38Z as `sign seq=1 accepted state=HEALTHY`; seq=2 and seq=3 were also HEALTHY.
- Windows was then locked; Railway continued accepting HEALTHY heartbeats through at least seq=8 at 22:31:08Z.
- This proves self-heal, V380-GUI independence, and locked-screen operation.

## Still open

- A full Windows reboot after the SYSTEM-supervisor cutover is not yet live-proven. The remote-control layer blocked restart/shutdown. Treat cold-boot persistence as configured but unreceipted until a later controlled reboot shows Session-0 startup and fresh Railway heartbeats before desktop login.
- Consumer Windows 10 ESU enrollment remains incomplete and separate from camera authority.
- C: had about 2.53 GB free (6.3%) at closeout. Camera logs/DBs were small; active worktrees were deliberately preserved.

## Safety / operating rules

- Do not re-enable the interactive camera supervisor while the Session-0 lane is healthy.
- Do not reopen V380 GUI/WGC as a hidden production dependency.
- Preserve the active calibration and camera ledgers unless a measured recommissioning replaces them.
- Do not delete active worktrees merely for disk cleanup; reconcile ownership first.
- GitHub `origin/main` and live production evidence outrank stale local notes.

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
