# Statenour OS — Local Smart Home Agent

Polls smart home devices and syncs state to statenour-os cloud API.

## Quick Start

```bash
cd local-agent
pip install -r requirements.txt
cp .env.example .env   # edit with your keys
python agent.py --once  # test single cycle
python agent.py         # run continuous polling
```

## Architecture

```
agent.py          ← Unified orchestrator (runs all sub-agents)
tuya_agent.py     ← Tuya Cloud API polling + command execution
ring_agent.py     ← Ring doorbell/camera sync
ring_setup.py     ← One-time Ring 2FA setup (interactive)
eufy_agent.py     ← Eufy Security camera sync (WS bridge or HTTP)
v380_agent.py     ← V380 camera status via cloud P2P
```

## Flags

| Flag | Effect |
|------|--------|
| `--once` | Single poll cycle then exit |
| `--tuya-only` | Only poll Tuya devices |
| `--no-ring` | Skip Ring polling |
| `--no-eufy` | Skip Eufy polling |
| `--no-v380` | Skip V380 polling |

## Ring Setup (first time)

Ring requires 2FA. Run interactively once:
```bash
python ring_setup.py
```
Token is cached in `.ring_token` for subsequent runs.

## V380 Cameras

V380 uses P2P cloud relay. For direct RTSP streams, place a
device on the shop's LAN and scan for cameras on port 554.


## Scoped Eufy-only daemon

For a shop-side camera host that should run the Eufy bridge/event/control/health lane without
polling Tuya, Ring, or V380, use:

```powershell
python agent.py --eufy-only
```

This mode still:
- starts the Eufy semantic-event listener;
- checks the Eufy command queue every local-agent cycle, but only claims commands when
  `EUFY_CONTROL_ENABLED=1` and bridge auth is healthy;
- posts the role-aware Nick's office-camera heartbeat every cycle when the separate
  `NICKS_CAMERA_HEARTBEAT_URL` + `NICKS_CAMERA_INGEST_KEY` are configured;
- polls Eufy device inventory on the normal slower cadence.

It deliberately does **not** run Tuya, Ring, V380, or their command paths. On a host that is
not on the office camera LAN, keep `EUFY_CONTROL_ENABLED=0` so it cannot consume PTZ work.

## Eufy bridge, office motion events, and PTZ

Security boundary: Eufy credentials/session material is machine-local. Never commit
`eufy-ws-config.json`, `eufy-ws-config.local.json`, or `eufy-data/`. If a legacy
bridge needs JSON credentials, copy `eufy-ws-config.example.json` to an ignored local
file and fill it only on the machine running the bridge.

StateNour can use the current `mega-yfue/ha-eufy-sdk-bridge` as the **single authenticated Eufy
session** for live device state, semantic camera events, and capability-gated PTZ. When
`EUFY_BRIDGE_URL` is configured, `eufy_agent.py` does not start a second Eufy cloud login. This
avoids the two clients kicking each other into re-auth.

### Bridge v0.3.0 runtime overlay

Live commissioning on 2026-09-26 proved that upstream bridge v0.3.0 advertises the SDK's
`ptz` capability but does not include `dev.ptz()` in its WebSocket `device.action` router.
It also generates go2rtc listeners on all interfaces. Apply the reviewed, version-pinned overlay
before enabling StateNour PTZ control:

```bash
python eufy_bridge_overlay.py --bridge-root /path/to/ha-eufy-sdk-bridge-0.3.0 --apply
python eufy_bridge_overlay.py --bridge-root /path/to/ha-eufy-sdk-bridge-0.3.0 --check
```

The overlay fails closed on an unknown bridge version or source drift. For the reviewed v0.3.0
source it exposes direct PTZ actions plus the narrow `preset.goto` namespace and binds go2rtc
API/RTSP/WebRTC to `127.0.0.1`. It does not make an unreachable camera reachable.

The live Windows commissioning used go2rtc v1.9.14 win64 with SHA-256
`dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907`.

Recommended local configuration:

```env
EUFY_BRIDGE_URL=ws://127.0.0.1:3000/ws
EUFY_CONTROL_ENABLED=0
EUFY_EVENTS_ENABLED=1
EUFY_OFFICE_CAMERA_SERIAL=T8410P5225154105
# Optional comma-separated override. If unset, only the office camera above
# forwards semantic events into StateNour.
# EUFY_EVENT_DEVICE_SNS=T8410P5225154105
```

Keep `EUFY_CONTROL_ENABLED=0` until bridge auth, device identity, and the reported `ptz` capability
have been checked on the machine actually running the bridge. The local agent refuses to claim Eufy
command-queue rows until that flag is `1` **and** bridge auth reports `ok`.

Supported StateNour commands:

| Command | Params | Upstream bridge action |
|---|---|---|
| `ptz` / `ptz_rotate` | `{"direction":"left|right|up|down"}` | `device.action` |
| `ptz_left/right/up/down` | none | matching directional action |
| `ptz_preset` | `{"id":3}` | `preset.goto(3)` |

PTZ is fire-and-forget at the Eufy P2P layer. An ack means the bridge accepted/sent the command; it
does **not** prove the camera finished moving. The later `ptzNotify` event is stored independently as
movement evidence. Motion/person/vehicle/sound events from the configured office camera are also
forwarded to the existing `vision` sync ledger, which lets downstream interaction capture wake on
events instead of continuously analyzing every frame.

Do not expose the bridge WebSocket directly to the public internet. Keep it loopback/LAN-side and let
StateNour's authenticated device-command API remain the remote control plane.

Run the focused local contract tests from this directory:

```bash
python -m unittest test_eufy_bridge.py
```

## Shop-side Windows bootstrap

The office T8410's P2P/media path must run on the shop-side LAN host, not on a remote
observer behind another NAT/subnet. On the intended Windows host, run an elevated
PowerShell from this repo:

    .\install-eufy-shop-runtime.ps1 -InstallPrerequisites

The first run:
- pins bridge v0.3.0 to reviewed commit `f00dd987...`;
- downloads go2rtc v1.9.14 and verifies the official release ZIP SHA-256;
- applies + verifies the fail-closed PTZ/loopback overlay;
- creates a minimal Eufy-only Python environment;
- stores Eufy + StateNour/Nick's keys with Windows DPAPI under the current user;
- registers restart-capable bridge, Eufy-agent, and live event-only office-wake tasks;
- proves bridge auth, the exact office serial, PTZ capability, and a real media-byte probe;
- leaves the PTZ command queue **disabled by default**.

After reviewing the first live receipts, enable the command lane:

    .\install-eufy-shop-runtime.ps1 -EnableControl

For a bounded physical PTZ commissioning cycle, supply the already-approved Eufy home
preset. The command path waits for real `ptzNotify` receipts:

    .\install-eufy-shop-runtime.ps1 -EnableControl -CommissionPtz -HomePresetId 3

That proves the motor/control path only. Absolute home is still UNKNOWN until the
camera-bridge visual home verifier validates a post-receipt frame against the approved
reference image. The installer never enables office audio capture or bypasses the existing
recording-policy/media-quality gates.
