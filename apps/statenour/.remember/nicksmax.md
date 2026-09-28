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

## Office Eufy production role - 2026-09-28

LIVE VERIFIED:
- The Office Eufy camera (`T8410P522517180B`, T8410C) is **commissioned and PRODUCTION**, not SHADOW.
- NicksMax is the intended Office Eufy runtime host. NattyNour's `StateNour-Eufy-OfficeHealth` task was disabled during the authority correction; do not reintroduce it as the Office heartbeat authority.
- NicksMax runs `StateNour-Eufy-Bridge-NicksMax`, `StateNour-Eufy-Agent-NicksMax`, and `StateNour-Eufy-Watchdog-NicksMax`.
- Local Eufy bridge HTTP/WS is `127.0.0.1:3000`; go2rtc is isolated from the V380 sign stack on API `1984`, RTSP `8654`, WebRTC `8655`. V380 keeps `8554/8555`.
- NicksMax has its own Eufy bridge identity (`BRIDGE_OPENUDID`) so another SDK install on the same Eufy account cannot share the default client identity.
- The Eufy bridge authenticates successfully, enumerates 6 devices / 3 camera streams, and confirms Office capabilities including video, RTSP, PTZ and audio.
- Railway/Nick Admin accepted the durable NicksMax Office producer continuously from `office seq=1` at 23:27:07Z through at least `seq=14` at 23:35:23Z.

Health boundary:
- Office is production/commissioned but currently **MEDIA_DEGRADED**, not SHADOW.
- Forced Office media probes fail because the Eufy SDK reports `P2P connect timeout for T8410P522517180B`; Office state reports `hubStatus=false`.
- This is Office-device-specific: the same NicksMax bridge read 2048 real bytes from the same-model Kitchen T8410C stream with HTTP 200 in ~4.3s while Office returned 503/P2P backoff.
- Therefore do not demote Office to SHADOW to hide the fault. Keep the producer operational and let the interaction health lattice report the measured degradation until the Office device/account/P2P condition is repaired.
- A later repair is complete only when a real Office media-byte probe succeeds and Admin transitions out of MEDIA_DEGRADED; control/PTZ/home proofs remain separately truth-bearing.
