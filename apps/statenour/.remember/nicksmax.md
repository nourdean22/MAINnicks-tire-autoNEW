# NicksMax workstation + camera authority handoff — 2026-09-28

## Identity / bounded role

NicksMax is Nour's older Intel MacBook Air running Windows 10 (MacBookAir7,2 class, i5-5350U, 8 GB RAM, ~40 GB BOOTCAMP C:). It is a lean always-on edge/admin/recovery node.

Authority boundary:
- NicksMax is authoritative only for the bounded Nick's `sign` camera edge.
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
