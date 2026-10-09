# NicksMax workstation — current truth and setup receipt

**Date:** 2026-09-27  
**Scope:** local workstation / recovery node only. This document is not a production-deploy receipt.

## Executive decision

NicksMax is the right machine for a **lean always-on operations + recovery + lightweight development role**.

It is the wrong machine for heavy compute. The governing constraint is not only age; Windows currently lives on a roughly 40 GB BOOTCAMP partition inside a 128 GB Apple SSD. The machine has 8 GB RAM and a 2-core / 4-thread Broadwell i5. Heavy Docker, WSL, local LLMs, Frigate, large build trees, and duplicated schedulers would consume its scarce memory/storage and create a second operational authority.

Railway remains production authority. NicksMax is an edge/admin/recovery surface.

## Verified hardware / OS

| Item | Verified state |
|---|---|
| Apple model class | MacBookAir7,2 |
| CPU | Intel Core i5-5350U @ 1.80 GHz |
| CPU topology | 2 cores / 4 threads |
| RAM | 8 GB |
| SSD | Apple 128 GB class SSD |
| Windows volume | BOOTCAMP, about 40.2 GB |
| macOS/APFS | preserved; not deleted/repartitioned |
| Graphics | Intel HD Graphics 6000 |
| Battery | full-charge capacity ~75% of design |
| SSD health | Windows storage layer reports Healthy |
| Windows | Windows 10 Home 22H2 family, build observed 19045.6466 before ESU completion |

A separate ~63 GB APFS/macOS partition remains present. A ~9.3 GB hidden Basic Data partition resembles a Boot Camp/OSXRESERVED-style layout, but it was deliberately not deleted: reclaiming it would not directly extend C: without partition movement. No risky partition surgery was performed.

## Role contract

### NicksMax SHOULD do

- remain reachable over Tailscale
- provide a recovery workstation if the CEO laptop is unavailable
- provide Git/GitHub/VS Code access
- hold a tiny sparse/partial monorepo checkout
- run lightweight Windows-only utilities when explicitly needed
- provide SSH + Remote Desktop Commander recovery/admin paths
- run the lightweight production `sign` camera edge lane under the Session-0 supervisor
- run the commissioned Office Eufy bridge/agent/health lane with its non-conflicting local media ports
- serve as a future landing point for selected archives **when external storage is attached and verified**

### NicksMax SHOULD NOT do

- run a second production scheduler or Railway-equivalent worker
- run Frigate or GPU/video-heavy continuous inference on this hardware
- run local LLM/model stacks
- run Docker Desktop / WSL-heavy services as a standing workload
- mirror the CEO laptop's complete worktrees
- copy secrets, browser profiles, SSH private keys, or `.env` files wholesale
- become the sole copy of irreplaceable data
- perform bidirectional sync over the entire user profile

## Remote-management setup

### Tailscale

Verified:
- installed and authenticated
- `WantRunning=true`
- `ForceDaemon=true` / unattended operation
- persisted hostname preference = `NicksMax`
- direct Tailscale connectivity to NattyNour observed
- shop-PC connectivity observed through the tailnet

### Remote Desktop Commander

Verified:
- paired with ChatGPT
- working connector session
- login launcher created
- launcher detects an already-running process before starting another
- startup package pinned to `@wonderwhy-er/desktop-commander@0.2.51` instead of `@latest`

Reason for pinning: an always-on recovery node should not silently resolve a new Commander release at every login.

Known leak (2026-10-08): `read_file` with a negative offset (a tail) leaves its read handle open in Commander's node process until the agent restarts. That process was pid 9580, started 10-03, and it was still holding the supervisor log at 19:07 that evening. The handle shares read, write and delete, so it blocks only writers that refuse readers: Windows PowerShell 5.1's `Add-Content` and `Set-Content`. That is how the camera supervisor's log went dark from 07:34. The supervisor now writes through a shared FileStream. Read box logs through a shell (`Get-Content -Tail`), never `read_file`. To find a file's holder, ask the Restart Manager (`RmGetList`); `handle.exe` is not installed.

### SSH recovery path

Verified:
- Windows OpenSSH Server installed
- `sshd` running
- StartupType = Automatic
- `PasswordAuthentication no`
- `PubkeyAuthentication yes`
- `AllowUsers nourd`
- broad default OpenSSH firewall path disabled
- NicksMax-specific inbound rule is scoped to the Tailscale interface

Network reachability to TCP/22 over Tailscale was proven. A clean independent public-key-auth proof from NattyNour remained incomplete because NattyNour's SSH agent had no usable key loaded and the remote safety layer blocked generating a new private key. Do not weaken NicksMax to password SSH just to make this test green.

## Power / always-on behavior

Applied:
- Balanced power plan retained
- sleep disabled on AC
- hibernate disabled on AC
- display may turn off after 10 minutes
- lid close on AC configured not to sleep the machine
- pagefile left Windows-managed

Why: high-performance mode would mostly add heat on a 15 W Broadwell CPU; disabling the pagefile on an 8 GB machine would reduce reliability.

## Storage optimization

### Before

NicksMax had only about **5.10 GB free** on C: during the final baseline.

### CompactOS

Microsoft-supported CompactOS was enabled and verified.

Receipt:
- 49,549 Windows files compressed
- original stored data: 8,417,142,186 bytes
- compressed storage: 5,399,784,542 bytes
- compression ratio: 1.6:1
- free space improved from **5.10 GB -> 8.16 GB**
- system reports: **Compact state**

This was the highest-value safe storage optimization because Windows itself was the dominant fixed cost on the small BOOTCAMP partition.

### Hibernation

The hibernation file was removed on NicksMax, reclaiming additional space. The Windows-managed pagefile was preserved.

### Consumer-app reduction

Removed user-level packages included:
- Cortana package
- Weather
- Copilot
- Get Help / Get Started
- 3D Viewer
- Office Hub
- Solitaire
- Mixed Reality Portal
- OneNote Store app
- Outlook for Windows Store app
- People
- Skype
- Wallet
- Dev Home
- Feedback Hub
- Maps
- Xbox app / overlays / identity / speech stack
- Your Phone
- Groove Music / Movies & TV
- legacy Windows communications apps

Kept intentionally:
- Microsoft Store / winget
- Windows Security
- Calculator
- Paint
- Photos
- media codecs/extensions
- Windows runtimes/frameworks
- system shell components

No aggressive debloat script was used. Defender, Windows Update, Search, SysMain, pagefile, and Apple/Boot Camp drivers were not disabled.

## Lightweight workstation toolchain

Installed / verified:
- Node.js v24.19.0
- npm 11.17.0
- Corepack 0.35.0
- Git 2.55.0.windows.3
- GitHub CLI
- VS Code
- GitHub authenticated as `nourdean22`

Repo package-manager contract:
- root `package.json` declares `pnpm@10.4.1`
- `corepack pnpm --version` on NicksMax resolves exactly **10.4.1**
- a lightweight `pnpm.cmd` wrapper calls Corepack
- no full dependency install was performed

VS Code was tuned for this small machine:
- telemetry off
- experiments off
- no window pile restored at startup
- Git auto-fetch off
- Command Prompt default terminal (avoids PowerShell `.ps1` execution-policy friction for npm/npx)
- filesystem watchers exclude `node_modules` and `.git/objects`

## Monorepo checkout

Location:

`C:\Users\nourd\NicksMax\repos\NOURCITY`

Design:
- shallow/partial clone
- sparse checkout
- initial ops/doc/config view
- observed footprint about **27.4 MB**
- local checkout was clean on `main` at the observed snapshot
- Git config uses prune, fast-forward-only pulls, long paths
- repo-specific line-ending config follows the repo's LF contract
- local pre-commit guard blocks direct commits on `main`
- local pre-push guard blocks direct pushes to `main`

Helper:

`nicksmax-repo status|ops|nickstire|statenour|camera|update`

The helper expands only the code area needed for a task, then can return to the tiny ops view.

## Health tooling

Command:

`nicksmax`

Checks include:
- C: free space >= 6 GB
- free RAM >= 1.5 GB
- Windows-managed pagefile
- Defender realtime protection
- Tailscale unattended state
- Commander running
- Windows ESU current/enrolled status
- Git present
- NICKSMAX hostname active or pending
- CompactOS enabled
- SSH recovery service
- exact pnpm 10.4.1 contract
- NicksMax camera authority, process-session, and RTSP-path state

At the latest workstation-only pass, all checks were green except the two ESU checks.

## Camera production authority — 2026-09-28 closeout

The old sibling-session guard is closed. NicksMax now owns the lightweight production `sign` camera-processing lane.

Final verified topology:
- V380 desktop GUI is not a production dependency and was not running at closeout.
- native V380 cloud relay listens on `0.0.0.0:8554`
- FFmpeg reads `rtsp://127.0.0.1:8554/live`, crops the SHOPSIGN middle lens, scales to 640x360 at 4 fps, and publishes to MediaMTX
- MediaMTX exposes `rtsp://127.0.0.1:8555/sign`
- `edge_main.py` runs the production OpenVINO detector against that stream with `calib-nicksmax-sign-rtsp.json` (SHA256 `67F719CC875DEE8B0EFF9B246428CE9840530FB0921FA9BCC1FFB8803D502258`)
- the interactive `NicksMaxCameraSupervisorUser` task is disabled
- the production supervisor and restarted production edge tree run in Windows Session 0
- legacy WGC/V380-watchdog and shadow-candidate tasks are disabled

Commissioning included an actual failure injection: the old Session-1 production edge tree was killed while the user supervisor was disabled. The Session-0 supervisor recreated the wrapper at 18:27:11 ET and the Python/OpenVINO producer at 18:27:12 ET. Railway then accepted the restarted producer as HEALTHY beginning with `sign seq=1` at 22:27:38Z.

A Windows lock test also passed. With the desktop locked and no V380 GUI running, Railway accepted HEALTHY sign heartbeats through at least seq=8 (22:31:08Z). This proves GUI-free and locked-screen operation.

Evidence boundary: a full Windows reboot after the SYSTEM-supervisor cutover was not observed because the remote-control layer blocked restart/shutdown. Treat cold-boot persistence as configured but not yet live-proven. A later reboot receipt should verify Session-0 startup and fresh Railway heartbeats without logging into the desktop.

Storage note: C: had about 2.53 GB free (6.3%) at camera closeout. Camera logs/DBs were small; active worktrees were the largest obvious reclaim candidates and were deliberately left untouched.

## Office Eufy production authority - 2026-09-28

NicksMax owns the commissioned Office Eufy interaction/health lane. The canonical camera is **NICKS EUCLID** (`T8410P5225154105`, T8410C); `Moes Euclid Office` (`T8410P522517180B`) is legacy and must not be used as the production target.

Verified runtime:
- Eufy bridge HTTP/WS: `127.0.0.1:3000`
- go2rtc API: `127.0.0.1:1984`
- Eufy RTSP: `127.0.0.1:8654`
- Eufy WebRTC: `127.0.0.1:8655`
- V380 sign ports remain `8554/8555`
- scheduled tasks: `StateNour-Eufy-Bridge-NicksMax`, `StateNour-Eufy-Agent-NicksMax`, `StateNour-Eufy-Watchdog-NicksMax` (the watchdog was retired 2026-10-07; the camera supervisor is the only authority)
- 2026-10-09: `start-bridge-nicksmax.ps1` is in the repo at `camera-bridge/scripts/nicksmax/`, installed by `install-nicksmax-supervisor-host.ps1` (see the camera host doc, "Host scripts"); it now keeps the previous run's bridge logs as `.prev`.
- 2026-10-08: `start-bridge-nicksmax.ps1` (box-local at the time; backup `start-bridge-nicksmax.ps1.pre-node-identity`) launches node with `server.mjs` by its absolute path, because the camera supervisor now knows the bridge's node by that path and leaves any other node `server.mjs` alone. Restarted after close at 22:03:03Z: node pid 29724 `"C:\Program Files\nodejs\node.exe" "C:\Users\nourd\AppData\Local\StateNour\Eufy\ha-eufy-sdk-bridge-0.3.0\server.mjs"`, go2rtc 27792 its child, ports 3000 / 1984 / 8654 / 8655, `/healthz` auth ok. The office heartbeat read AUTH_DEGRADED for one beat (seq 1041, 22:03:19Z; one "Camera degraded" page at 22:03:39Z) and was back at 22:03:55Z. Reverting the launcher requires reverting the supervisor's node needle first.
- bridge auth is `ok`; NICKS EUCLID reports video, RTSP, PTZ, audio, motion and person capabilities
- corrected NicksMax producer cycles complete without errors and receive `streamState` from `T8410P5225154105`
- direct media probe succeeds with `mediaPlaneOk=true`
- Nick backend transitioned `MEDIA_DEGRADED -> UNVERIFIED_CAPABILITIES` at corrected Office seq=1

Remaining proof is capability commissioning, not media recovery: wait for/produce a fresh semantic event, obtain a fresh PTZ/control receipt, and create a NICKS-EUCLID-specific visual-home reference before claiming those facets healthy. Never reuse old Moes calibration/home evidence for NICKS EUCLID.

## Office Intelligence runtime - 2026-09-28/29

NicksMax now also runs the bounded Office conversation-intelligence edge path for NICKS EUCLID.

Verified:
- reviewed Eufy bridge `/record/T8410P5225154105` route returns H.264 plus AAC 16 kHz mono without Chrome or a Windows microphone
- Eufy port split remains 3000 / 1984 / 8654 / 8655; V380 remains 8554 / 8555
- `StateNour-OfficeIntelligence-NicksMax` was commissioned as SYSTEM / AtStartup and is the only OfficeWake/capture/STT owner
- the worker receipt advances continuously; current after-hours state is `OFF_HOURS`, `workerOk=true`, queue 0, failures 0, source `eufy-office`, STT `whisper-cli.exe`
- the OfficeWake ledger confirms connection to the NICKS EUCLID semantic-event bridge
- the live Eufy agent consumes that receipt and includes the worker facets in the authoritative `office` heartbeat payload
- a real 15-second NICKS EUCLID audio capture produced a valid ~447 KB WAV; the room was quiet (~ -71.8 dBFS mean, -50.6 dBFS peak), so the -35 dB speech gate correctly emitted no episode
- raw-audio retention is bounded by age (6h), size (256 MB), and free-disk floor (768 MB)

Ownership:
- Eufy runtime installer owns Bridge + Agent and disables legacy `StateNour-Eufy-OfficeWake` if present.
- Office Intelligence installer owns event wake, bounded capture, local Whisper, posting, and status receipts.
- `camera_runtime.office` remains the single cloud current-state authority; OfficeWake writes only a local receipt for the Eufy agent to fold into that heartbeat.

Evidence boundary:
- edge capture/STT/runtime commissioning is live-proven.
- Admin/backend schema/UI changes are built/tested in the Office Intelligence branch but are not a production deploy receipt yet.
- the first real in-hours customer conversation -> stored evidence-backed summary -> visible Admin card remains the final natural commissioning proof.

## Windows 10 ESU — why it is required

Windows 10 normal support ended on **2025-10-14**. Microsoft no longer provides ordinary Windows 10 security updates to unenrolled consumer devices after that date.

Consumer **Extended Security Updates (ESU)** keeps eligible Windows 10 22H2 Home/Pro-class PCs receiving **critical and important security updates** while they remain on Windows 10. ESU is not a feature upgrade and does not provide ordinary technical support or product improvements.

For NicksMax, this matters because the machine is intentionally being converted into an **always-on remotely reachable operations node**. Leaving it on an unpatched Windows 10 build would create an avoidable security risk even though Defender and Tailscale are enabled.

Current Microsoft guidance checked on 2026-09-27:
- consumer ESU enrollment remains available
- coverage runs through **2027-10-12**
- eligible editions include Windows 10 22H2 Home
- latest Windows updates and the ESU Licensing Preparation Package are prerequisites
- the licensing-preparation package does **not** enroll the machine by itself
- enrollment is completed from **Settings -> Update & Security -> Windows Update -> Enroll now**
- a Microsoft account is required for the enrollment flow; Microsoft offers the current consumer enrollment options in that wizard

NicksMax state at the last check:
- ESU eligibility evaluator: eligible
- licensing-preparation package: already installed
- ESU status: not enrolled
- Windows profile: no Microsoft-account identity detected
- observed OS build: 19045.6466, behind current ESU servicing

Therefore the remaining ESU action is an operator/account step, not missing workstation code.

## Remaining workstation finish sequence

The camera sibling-session block no longer prevents a future controlled reboot. The remaining workstation actions are:
1. complete consumer Windows ESU enrollment through the Microsoft-account / Windows Update flow
2. when no other active sessions would be disrupted, perform one controlled reboot
3. after boot, verify Tailscale, Desktop Commander, the Session-0 camera supervisor, RTSP 8554/8555, and fresh production camera heartbeats before logging into or opening V380

The reboot is now a commissioning proof for persistence, not a prerequisite for the already-running camera lane. Do not call cold-boot persistence verified until that receipt exists.

## Source-of-truth boundary

This document records verified workstation configuration plus the 2026-09-28 NicksMax camera-authority closeout.

It proves the current Session-0 camera path, self-heal after killing the interactive production tree, Railway HEALTHY heartbeat acceptance, and continued operation while Windows is locked with the V380 GUI absent.

It does **not** prove:
- a full cold boot after the SYSTEM-supervisor cutover
- consumer ESU enrollment completion
- unrelated Railway deployments or application changes beyond the observed camera-heartbeat receipts
- that active worktrees are safe to delete

Reverify live process/session state and Railway camera heartbeats before changing the camera authority or deleting recovery artifacts.

## 2026-09-28 camera-role promotion

The 2026-09-27 workstation decision remains valid for general compute, but the camera role
changed materially the next day. NicksMax is now the production edge for Nick's `sign`
camera through a measured direct V380 cloud/P2P -> local RTSP chain. This is a deliberate
lightweight edge exception, not permission to turn NicksMax into a second general scheduler,
Docker, local-LLM or Frigate host.

The earlier V380 sibling-session guard is closed for this workstream: the direct camera path
no longer requires the V380 desktop GUI. A SYSTEM-owned scheduled supervisor has a successful
`ServiceAccount / Highest / Running` receipt, while a literal physical cold-reboot or
power-loss proof remains a distinct unperformed test.

See `docs/operations/NICKSMAX-CAMERA-HOST-2026-09-28.md`.
