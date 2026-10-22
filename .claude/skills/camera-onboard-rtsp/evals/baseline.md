# Baseline: camera-onboard-rtsp

recorded: 2026-10-22

Question: what fails when someone adds or repairs a shop camera WITHOUT this skill?

## Tasks run without the skill

| task | what happened | evidence |
|---|---|---|
| T1: a camera that delivers frames but sees nothing useful (recorded incident, 2026-10-05, not a fresh run) | The edge counted 4 arrivals on a day of roughly 40 cars. Frames kept arriving and the detector kept running, so every health signal read fine, and a blind camera read as a low count instead of UNKNOWN. Nothing in the heartbeat could say the lot was not being watched. | Code comment in camera-bridge/edge_main.py (search "2026-10-05"); the fix is the detectionsLast10m window and the blind state in apps/nickstire/server/lib/cameraHealth.ts |
| T2: a camera whose app gives no RTSP or ONVIF (recorded incidents, 2026-09-08 and 2026-10-21, not a fresh run) | The plan for the closed-app shop cameras walked toward an unlock file and four hobby protocol bridges, all rejected as reverse-engineered, unlicensed, or relaying video through third-party clouds. Six weeks later, the bay camera plan in agent memory again proposed a second cloud-relay launcher. The stop point (no RTSP or ONVIF, so swap the camera) was never written where an agent starts. | docs/UPSTREAMS.md row "V380 protocol bridges" (REJECT, 2026-09-08); camera-bridge/README.md section 1 (the unlock branch); agent memory file shop-eyes-ears-2026-10-21.md item 4. CLAIM, not re-verified: a safety stop on 2026-10-22 refused to build an installer for an unlicensed decoder (reported in the manager brief) |
| T3: fresh headless run without the skill, asked to hook up a new cheap phone-app camera (attempted 2026-10-22, did NOT run) | The run never started. The headless CLI returned an authentication error, so there is no answer to judge. This row is not evidence of a failure; it records that the fresh-run requirement is unmet and that T1 and T2 are incident rows only. | Command: claude -p with --no-session-persistence, --model sonnet and --allowedTools Read,Grep,Glob from the clone root; output: Failed to authenticate: OAuth session expired and could not be refreshed; exit 1 |

## Failure shape

Without the skill, "hook up this camera" is treated as a build task. The agent reaches for whatever decoder, relay or bridge makes a closed-app camera readable, and the camera that is added or repaired is never shown to see a real scene, so a dead or blind stream is counted as zero cars. The skill must stop at the first step when the camera has no RTSP or ONVIF in its spec (swap the camera, build nothing), and it must end on a real first event plus the plausibility check where a camera that sees nothing says UNKNOWN or blind, never zero.
