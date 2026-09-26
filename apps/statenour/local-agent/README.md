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


## Eufy bridge, office motion events, and PTZ

StateNour can use the current `mega-yfue/ha-eufy-sdk-bridge` as the **single authenticated Eufy
session** for live device state, semantic camera events, and capability-gated PTZ. When
`EUFY_BRIDGE_URL` is configured, `eufy_agent.py` does not start a second Eufy cloud login. This
avoids the two clients kicking each other into re-auth.

Recommended local configuration:

```env
EUFY_BRIDGE_URL=ws://127.0.0.1:3000/ws
EUFY_CONTROL_ENABLED=0
EUFY_EVENTS_ENABLED=1
EUFY_OFFICE_CAMERA_SERIAL=T8410P522517180B
# Optional comma-separated override. If unset, only the office camera above
# forwards semantic events into StateNour.
# EUFY_EVENT_DEVICE_SNS=T8410P522517180B
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
