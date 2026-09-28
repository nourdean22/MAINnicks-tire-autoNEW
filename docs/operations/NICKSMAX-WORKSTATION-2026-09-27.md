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
- support V380/camera work owned by the separate camera session
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
- V380 protected install / running state

At the latest workstation-only pass, all checks were green except the two ESU checks.

## V380 / active sibling-session guard

A separate ChatGPT/Codex session is actively configuring camera work on this machine.

Verified:
- V380 Pro 2.0.9 installed
- executable: `C:\Program Files (x86)\V380\V380.exe`
- V380 observed running
- workstation setup did not add a V380 Run-key or scheduled task
- workstation setup did not alter V380 camera/network configuration

Local guard:

`C:\Users\nourd\NicksMax\ACTIVE-WORK.md`

**Do not reboot, kill V380, change its startup behavior, or perform camera-stack cleanup while the sibling camera session is active.**

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

## Deferred finish sequence

A sibling camera session is active, so reboot was deliberately withheld.

Safe command already staged:

`finish-nicksmax`

It:
1. checks the active-work guard
2. checks whether a Microsoft account is linked
3. opens Windows account settings if needed
4. invokes the official ESU eligibility path
5. opens Windows Update
6. runs the NicksMax doctor
7. reports whether V380 and ChatGPT are active
8. requires the literal confirmation `REBOOT` before restarting

The reboot is needed to:
- finalize the Windows hostname change from the old generated desktop name to **NICKSMAX**
- clear pending Windows servicing / file-renames
- prove Tailscale and Commander persistence after boot
- run the staged post-reboot verifier

Do not run that reboot while the sibling camera session still owns active work.

## Source-of-truth boundary

This document records verified workstation configuration and local receipts from 2026-09-27.

It does **not** prove:
- any production Railway change
- any camera/V380 configuration outcome owned by the sibling session
- ESU enrollment completion
- the final post-reboot NICKSMAX hostname/persistence receipt

Those require their own evidence after the sibling session finishes and the controlled reboot occurs.

## 2026-09-28 superseding update — NicksMax is now the authoritative `sign` camera host

The camera-session guard and the earlier "do not use NicksMax for continuous vision" rule are superseded for the specific fixed `sign` camera lane. The measured workload is intentionally bounded and has been proven on this hardware.

### Final architecture

```text
SHOPSIGN V380 cloud/P2P
  -> local V380Decoder relay on NicksMax
  -> rtsp://127.0.0.1:8554/live (three-lens 1920x3240 stack)
  -> FFmpeg middle-lens crop + scale, 640x360 @ 4 fps
  -> loopback MediaMTX rtsp://127.0.0.1:8555/sign
  -> camera-bridge edge_main.py + OpenVINO vehicle-detection-0200
  -> Nick camera heartbeat/visit ingest
```

### Verified receipts

- Production camera row: `camera=sign`, `sourceType=rtsp`, `state=HEALTHY`.
- Active calibration: `sha256:67f719cc875d`.
- Current detector: `DetectorCouncil` / OpenVINO `vehicle-detection-0200`.
- The direct producer publishes fresh `lastFrameAt` / `lastHealthyFrameAt` timestamps.
- V380 desktop GUI was force-closed while ports 8554/8555/9095 remained live; subsequent Railway heartbeats continued HEALTHY. The production lane therefore no longer depends on the V380 GUI or another PC.
- The production edge was force-killed as a recovery test. The NicksMax supervisor loop recreated a new producer instance automatically and the live DB returned to HEALTHY.
- Retired WGC tasks remain disabled: `V380Watchdog`, `NickEdgeProducer`, `NickEdgeProducerRight`, `NickEdgeSignCandidate`.
- Exactly one current-user supervisor loop is installed as `NicksMaxCameraSupervisorUser`; it starts at NicksMax logon and runs the hardened supervisor every 30 seconds.
- Disk headroom after cleanup: about 2.53 GB free. The required .NET 10 runtime, FFmpeg/ffprobe essentials, MediaMTX, V380Decoder binary, model, calibration, ledgers and hard-case corpus remain intact.

### Authority boundary

NicksMax is authoritative only for the bounded `sign` camera edge role. Railway remains the cloud application / database / scheduler authority. NicksMax is still not a Docker, local-LLM, Frigate, or general-purpose production worker host.

### Remaining operator-only workstation item

Consumer Windows 10 ESU enrollment remains separate from camera authority. The camera lane is operational without the V380 GUI, but a cold boot still requires the NicksMax Windows user session before the current-user supervisor task can run; creating a pre-login SYSTEM task requires an elevated local action not available to the non-elevated remote shell.
