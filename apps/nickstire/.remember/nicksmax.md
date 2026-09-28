# NicksMax / V380 local-node handoff — 2026-09-27

NicksMax is a newly provisioned lightweight Windows workstation and recovery node. It is an old MacBookAir7,2-class machine (i5-5350U, 8 GB RAM, small BOOTCAMP partition), so keep camera/local duties lightweight.

## Camera-session guard

A sibling ChatGPT/Codex session is actively configuring V380 Pro on NicksMax.

Verified:
- V380 Pro 2.0.9 installed at `C:\Program Files (x86)\V380\V380.exe`
- V380 was running during workstation setup
- no V380 Run-key or scheduled-task startup entry was added by the workstation setup session
- workstation setup did not change V380 camera/network/configuration state

**Do not reboot, kill V380, change its startup behavior, or repurpose its camera configuration while that sibling session is active.**

## Node role

NicksMax may be used for:
- remote shop/CEO administration over Tailscale
- recovery access
- lightweight Git/GitHub/VS Code work
- selected Windows-only utilities
- camera-related work only when explicitly owned by the active camera session

NicksMax must not become:
- another Railway scheduler/worker authority
- a Frigate/vision-heavy host on this hardware
- a Docker/local-LLM compute box
- a full mirror of the CEO laptop's worktrees, secrets, caches, or dependency trees

Full receipt: `docs/operations/NICKSMAX-WORKSTATION-2026-09-27.md`.

## 2026-09-28 · superseding camera authority truth

NicksMax now owns the commissioned Nick's `sign` camera edge in production. The old sibling-session guard and the earlier blanket prohibition on continuous camera inference are obsolete for this specific bounded lane.

Current verified chain:
- V380 cloud/P2P -> localhost 8554 three-lens stack
- FFmpeg middle-lens crop -> MediaMTX `rtsp://127.0.0.1:8555/sign`
- OpenVINO edge producer -> Nick camera ingest
- calibration `sha256:67f719cc875d`
- live `sourceType=rtsp`, `state=HEALTHY`

V380 GUI independence is proven: V380 was closed and production heartbeats continued HEALTHY. Edge self-heal is also proven: the production Python process was killed and a new producer instance came back HEALTHY under the supervisor loop.

Retired local tasks stay disabled: `V380Watchdog`, `NickEdgeProducer`, `NickEdgeProducerRight`, `NickEdgeSignCandidate`.

Do not re-enable the old WGC tasks or create a second `sign` authority. The local supervisor task is `NicksMaxCameraSupervisorUser`. Railway remains cloud/scheduler/database authority; NicksMax is authoritative only for the bounded `sign` camera edge.
