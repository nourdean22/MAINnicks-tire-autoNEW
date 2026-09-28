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
