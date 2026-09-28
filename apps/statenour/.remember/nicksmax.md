# NicksMax workstation handoff — 2026-09-27

## Identity / role

NicksMax is Nour's older Intel MacBook Air running Windows 10, repurposed as a **lean always-on operations + recovery + lightweight dev workstation**.

Verified hardware:
- MacBookAir7,2 class / Intel Core i5-5350U 1.80 GHz
- 2 cores / 4 threads
- 8 GB RAM
- Apple 128 GB SSD
- Windows BOOTCAMP partition is only about 40 GB; macOS/APFS remains preserved
- Intel HD Graphics 6000
- battery full-charge capacity ~75% of design
- Windows storage layer reports SSD Healthy

This node is intentionally **NOT** a Docker / WSL-heavy / local-LLM / Frigate / production-scheduler machine. Railway remains production authority.

## Current workstation truth

Completed and verified:
- Tailscale installed, logged in, unattended/daemon mode enabled; persisted hostname preference = `NicksMax`
- Remote Desktop Commander paired and working; login launcher exists and is pinned to `@wonderwhy-er/desktop-commander@0.2.51`
- OpenSSH Server installed, running, startup Automatic; password authentication disabled; user `nourd` only; firewall rule scoped to Tailscale
- Git 2.55.0.windows.3, GitHub CLI, VS Code installed
- GitHub authenticated as `nourdean22`
- sparse/partial monorepo checkout at `C:\Users\nourd\NicksMax\repos\NOURCITY`; ops view ~27 MB, clean on `main`
- direct commit/push guards protect `main` on this checkout
- Node v24.19.0; repo package-manager contract resolves exactly to pnpm 10.4.1 through Corepack; no full dependency install
- Windows-managed pagefile preserved; Defender preserved/enabled
- AC sleep + hibernate disabled; lid-close on AC does not sleep the node
- Chrome forced autostart removed
- startup intentionally minimal: Commander, Tailscale, Windows Security, one-time post-reboot verifier
- CompactOS enabled and verified: OS binaries compressed from 8.42 GB to 5.40 GB; C: free space improved from 5.10 GB to 8.16 GB before later activity
- 27 consumer Store apps removed, including Xbox stack, Solitaire, Mixed Reality, Skype, Copilot, Office hub/OneNote/Outlook app, Maps, Your Phone, Groove/Movies
- lightweight UI/background tuning applied; no Defender/Search/SysMain/pagefile disable hacks
- local health command: `nicksmax`
- repo helper: `nicksmax-repo status|ops|nickstire|statenour|camera|update`
- safe finalizer: `finish-nicksmax`

## Active-work guard

Another ChatGPT/Codex session is actively using NicksMax for V380/camera work.

Protected application:
- V380 Pro 2.0.9
- `C:\Program Files (x86)\V380\V380.exe`
- observed running during setup

Do not reboot NicksMax, kill V380, alter V380 startup/network configuration, or perform camera-stack cleanup while that sibling session is active. The local file `C:\Users\nourd\NicksMax\ACTIVE-WORK.md` records this guard.

## Deferred / operator-bound

1. **Windows 10 Consumer ESU enrollment** is still not complete. The machine is eligible, but the Windows profile had no Microsoft-account identity linked at the last check. Use Settings -> Update & Security -> Windows Update -> Enroll now and follow the Microsoft-account flow.
2. **Controlled reboot** is still deferred because of the sibling V380/camera session. The reboot is needed to finalize the Windows computer-name change to `NICKSMAX`, clear pending servicing, and prove Tailscale/Commander/startup persistence.
3. Post-reboot verifier is already staged and will record hostname, Tailscale, doctor output, reboot flags, Microsoft-account precheck, and whether V380 is running.

## Authority / safety

- NicksMax is not production authority.
- Current production + Railway receipts outrank this local node.
- GitHub `origin/main` outranks its local checkout.
- Do not copy CEO-laptop worktrees, secrets, browser profiles, `.env` files, Docker state, or large `node_modules` trees here.
- Prefer sparse/partial clones and regenerate dependencies only when a real recovery task requires them.

## 2026-09-28 · NicksMax camera role superseded

The prior "NicksMax is not a continuous vision host" statement is superseded for one measured workload: NicksMax now runs the commissioned Nick's `sign` camera edge.

Production truth:
- direct V380 cloud/P2P relay on NicksMax, no V380 GUI dependency
- three-lens relay cropped to the fixed side-lot/sign lens and republished on loopback RTSP
- OpenVINO producer is live with `sourceType=rtsp`
- calibration `sha256:67f719cc875d`
- production state HEALTHY with fresh frame timestamps
- producer crash/restart self-heal proven
- legacy WGC/right producers remain disabled

This does not make NicksMax a general compute authority. Railway still owns cloud app/database/schedulers; NicksMax's special authority is only the bounded `sign` camera edge. The current supervisor starts at NicksMax user logon; a true pre-login SYSTEM task remains an elevation-only host hardening item.
