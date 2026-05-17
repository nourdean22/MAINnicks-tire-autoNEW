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
