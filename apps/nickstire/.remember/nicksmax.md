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
- **Update 2026-10-07 (camera audit):** Session-0 supervisor startup after a Windows start was observed on 2026-10-02 09:15 ET and 2026-10-03 13:56:58 ET (`Win32_OperatingSystem` LastBootUpTime; the production chain was back by 13:58:52 under SYSTEM). Still unrecorded: fresh Railway camera heartbeats after a boot with nobody logged in. Treat cold boot as observed-twice, not proven. The live task is `NicksMaxCameraSupervisorSystem` (at startup; its loop calls the tick about every 30 s), not the one-minute `NicksMaxCameraSupervisor` the 09-28 scripts register.
- C: had about 2.53 GB free (6.3%) at closeout. Camera logs/DBs were small; active worktrees were the largest obvious reclaim candidates and were deliberately left untouched. **2026-10-07:** 113 MB free of 40.16 GB, CPU load 100 % on the 2-core i5-5350U, with ChatGPT desktop, Claude desktop, Codex CUA and a V380 desktop client running on the sensor host. Reclaim is an operator action; the supervisor in PR #2920 holds a 1 GB floor once NicksMax pulls.

## Operating rules

- Keep the direct cloud -> 8554 -> crop -> 8555/sign -> OpenVINO path as the production architecture.
- Do not reopen V380 GUI/WGC as a hidden production dependency.
- Keep one authoritative `sign` producer; do not re-enable the user supervisor while the SYSTEM lane is healthy.
- Preserve the production calibration and camera ledgers unless a measured recommissioning explicitly replaces them.
- NicksMax stays lightweight: camera edge/admin/recovery work is allowed; Railway scheduler duplication, Docker/LLM stacks, Frigate-class workloads, and broad worktree duplication are not.
- Consumer Windows ESU enrollment remains a separate workstation/security task.
- **Never read box logs with Desktop Commander's `read_file` (tail / negative offset); use a shell (`powershell -NoProfile -Command "Get-Content -Tail 40 <path>"`).** Witnessed 2026-10-08 07:34: its reverse reader leaked a read handle in its node process (Restart Manager names it; pid 9580 that day, alive since 10-03). The handle shares read, write and delete. What broke was the WRITER: Windows PowerShell 5.1's `Add-Content` and `Set-Content` open without read sharing, so they fail beside ANY reader. Every supervisor line from 08:20 to the fix went to `<log>.overflow`; 07:34-08:20 is lost. The supervisor now writes through a FileStream sharing all three (`Write-SharedFile`), and the next tick restores overflow lines into the log under `NOTE restored N line(s)`. **Any other 5.1 script that writes with `Add-Content`/`Set-Content` has the same weakness**, including the box-local `data\` supervisor loop and shim. To find a file's holder: Restart Manager (`RmGetList`); `handle.exe` is not installed. A leaked handle clears when the Desktop Commander agent restarts or the box reboots.
- **A venv `python.exe` is a launcher: the real interpreter is its child with the same command line** (pairs 50-360 ms apart in the process table). Any "duplicate process" logic must count process trees, never processes -- the first per-process dedupe killed the child under every venv worker and restarted the office worker and the Eufy agent every two minutes for 40 minutes on 2026-10-08. The sign edge's launcher wrapper (`run-sign-rtsp-production.ps1`) likewise stays alive as the edge's parent for its whole life; "launcher alive" means "edge running", not "edge starting".
- **Supervisor tick budget (2026-10-09).** The loop that runs the tick lives only on the box (`camera-bridge\data\nicksmax-camera-supervisor-loop.ps1`, not in the repo): a fresh `powershell.exe` per tick, killed at 45 s, then a 30 s sleep. It killed 422 ticks 10-03..10-08. The tick now logs `NOTE slow tick: <total> ms (pid=N); <phase> <ms>, ...` (slowest first) past 30 s, and the next tick logs `NOTE slow tick: pid=N ... did not finish: in <phase> ...` for one the loop killed; the pid matches the loop log's `killed pid=`. Read them with `Get-Content -Tail` / `Select-String "slow tick"` in a shell. The shim's fallback `data\nicksmax-camera-supervisor.fallback.ps1` was dated 2026-09-29 (it lacked every 10-07/10-08 fix); since this change a tick that runs to its end rewrites it with the text it ran (`ACTION refreshed the fallback supervisor copy`), staged as `.new` and swapped in. A sign-crop restart now ends the old crop (its ffmpeg and launcher) and starts a new one only once `.sign-crop.lock` is free; before, a launcher started beside a live crop logged `SKIP duplicate sign crop; lock held` and exited, and the no-op still counted toward ESCALATE. Box-local, not fixed here: the relay runs with `--debug`, ~18 MB/h into `relay-system.stderr.log` (215 MB after 12 h; `mediamtx-sign.log` 104 MB) on a box that has hit 0.04 GB free.

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

LIVE VERIFIED END-TO-END:
- NICKS EUCLID (`T8410P5225154105`) has a headless local recording route at `http://127.0.0.1:3000/record/T8410P5225154105`; Chrome and the Windows mic are not production dependencies.
- `StateNour-OfficeIntelligence-NicksMax` is the sole Office interaction worker. It was recreated from the hardened #2786 installer after activation and uses the existing local Whisper pipeline.
- User explicitly cleared the recording-policy gate on 2026-09-29; machine flags were verified `capture=1`, `policyAck=1`, `fallback=1`.
- Eufy semantic pushes remain unreliable as a sole wake source, so #2786's non-retained audio-energy fallback is active. Wake requires both sustained mean + peak thresholds, and cooldown begins after fallback capture finishes.
- First real automatic production run woke on `audioActivity` at 17:35:54Z with probe mean -48.2 dBFS / peak -27.1 dBFS, then completed bounded capture -> segmentation -> Whisper -> production ingest.
- Final live receipt at 17:39:57Z: 5 segments found, 5 prepared, 5 transcribed, 5 posted, 0 failed; coverages 1.000 / 0.911 / 0.919 / 0.742 / 0.167; one summary stored; one fact stored; STT latency 25,086 ms.
- Worker returned `READY`; fallback moved to `COOLDOWN`; failures today stayed 0.
- Admin read path is wired: `trpc.lot.conversations` reads `conversation_episodes`, hides self-tests, recomputes coverage, and returns summary/fact count to **Admin -> Lot -> Office intelligence -> Counter conversations**. Raw audio/full transcripts remain hidden from that screen.
- Eufy remained healthy (6 devices, 0 errors) and sign ports 8554/8555/9095 stayed healthy throughout activation.
- PR #2786 is merged as `59c34109e5cc861419011fb769bc693edd81c140`. No additional runtime code change was needed for the successful production receipt.
Health boundary:
- NICKS EUCLID media is healthy. The old Moes P2P timeout / `hubStatus=false` evidence is historical and must not be used to describe current Office health.
- `UNVERIFIED_CAPABILITIES` is currently honest: fresh semantic-event proof, PTZ/control receipt, and calibrated-home proof are still unknown in the current producer process.
- A `streamState` event proves media activity but is not a substitute for a real motion/person semantic-event receipt.
- Do not reuse Moes home references, PTZ receipts, calibration artifacts, or P2P-failure evidence for NICKS EUCLID. Camera-specific proofs must be recommissioned against `T8410P5225154105`.
