# Eufy live commissioning receipt — 2026-09-26

This is a live-state receipt, not a claim that every office-camera function is complete.

## Runtime

- Bridge: `ha-eufy-sdk-bridge` v0.3.0 on NattyNour.
- Bridge WebSocket: loopback `127.0.0.1:3000`.
- Authentication: stored Eufy session reused; bridge reported auth/ready and six devices.
- No second Eufy cloud login was started.
- go2rtc: v1.9.14 win64, SHA-256
  `dd4167d75cb04abe618855b7c71f8658bd009f60c1a71835d134d2c11c939907`.
- go2rtc API/RTSP/WebRTC were hardened to loopback listeners.

## Device identity and live settings

Office camera:
- name: Moes Euclid Office
- serial: `T8410P522517180B`
- model: T8410C
- reported capabilities include video, snapshot, motion, person detection, RTSP, PTZ, and audio
- `indoorMotionEnable=true` was observed live
- microphone and speaker were observed enabled

Reachable comparison camera:
- name: NICKS EUCLID
- serial: `T8410P5225154105`
- model: T8410C
- same PTZ/video family as the office unit

## What was proven live

### PTZ router

Upstream bridge v0.3.0 initially rejected:
`device.action action=left`

Root cause: the WebSocket router omitted `dev.ptz()` from its action surfaces even though the
underlying SDK exposes PTZ.

The local bridge was patched to expose the PTZ surface. A focused bridge wiring test proved:
- direct `left/right/rotate` routing
- narrow `preset.goto` routing through `dev.ptz().preset().goto(id)`
- no generic dotted-path traversal

### Physical PTZ proof

On NICKS EUCLID:
1. baseline JPEG captured;
2. one `right` PTZ step returned `ok:true`;
3. a fresh JPEG visibly changed camera pose;
4. one compensating `left` step was sent;
5. bridge received a real unsolicited `ptzNotify`;
6. a fresh post-restore JPEG returned near the original view.

Therefore PTZ command routing is LIVE + PHYSICALLY PROVEN on the reachable T8410.

A command acknowledgement alone is still not accepted as movement proof.

### Media proof

The bridge generated a real stream for NICKS EUCLID through go2rtc.

Fresh ffprobe receipt:
- transport: RTSP over localhost
- codec: H.264
- resolution: 2304x1296

Therefore the bridge -> go2rtc -> RTSP media path is LIVE + VERIFIED for the reachable camera.

### Office wake consumer

The merged `vision.officewake` process was started with:
- `dryRun=false`
- mode `events_only`
- office serial `T8410P522517180B`
- real bridge WebSocket

It connected successfully and is consuming real `motion` / `personDetected` pushes.
No office motion/person push had arrived at the time of this receipt.

This is a live event consumer, not a simulation.

## Unresolved office-camera fault

The office camera's control/media P2P path is NOT proven live.

Observed live failures included:
- `StationUnreachableError`
- P2P connect timeout
- bridge log: nothing could be sent to the office camera
- office property/media requests timed out

The same authenticated bridge successfully controlled/streamed the comparison T8410, so this is
currently isolated to the office camera rather than the account/session/bridge in general.

Do not promote office PTZ/media to LIVE until that camera's P2P path is restored and the same
physical/media receipts are repeated on `T8410P522517180B`.

## Audio boundary

Live audio/conversation recording was NOT enabled during this commissioning.

The merged capture path requires all of:
- `OFFICE_INTERACTION_CAPTURE_ENABLED=1`
- `OFFICE_AUDIO_POLICY_ACK=1`
- verified `OFFICE_MEDIA_URL`
- configured active-hours schedule
- `CAMERA_INGEST_KEY`

Those gates were not configured. They were not bypassed.

## Current claim states

| Capability | State |
|---|---|
| Bridge auth | LIVE + VERIFIED |
| Office device identity/capabilities | LIVE + VERIFIED |
| Office motion setting | LIVE + VERIFIED |
| PTZ bridge routing | LIVE + TESTED |
| Physical PTZ on reachable T8410 | LIVE + VERIFIED |
| go2rtc RTSP on reachable T8410 | LIVE + VERIFIED |
| Office event consumer | LIVE + CONNECTED |
| Office motion/person receipt | WAITING FOR REAL EVENT |
| Office camera PTZ | BLOCKED — P2P UNREACHABLE |
| Office camera media | BLOCKED — P2P UNREACHABLE |
| Office audio transcription/summaries | NOT ENABLED — POLICY/MEDIA GATES UNMET |


## Production activation update — 2026-09-27

The role-aware camera health layer is now deployed beyond the 2026-09-26 commissioning state.

### Nick's / TiDB production

- Main commit: `c6db7bd35baf3da90572f067c87993220cc6ce2f`.
- Railway deployments for MAINnicks-tire-auto and statenour-web reached terminal `SUCCESS`.
- Migration `0134_camera_interaction_health` was applied with a scoped runner to production TiDB only.
- Exact migration hash:
  `108091f416b2b91e279ad9cbde3e781864d8a343a35410271b81ac55806686ab`.
- All nine nullable transport-proof columns were independently re-read from INFORMATION_SCHEMA and the migration ledger row was verified.
- Reconciliation classifies 0134 as `RECORDED_AND_MATCHED`.
- The broader migration ledger still has unrelated pre-existing 0127-0133 drift; none of that was changed as part of this camera activation.

### Live role-separation proof

Production camera heartbeat logs proved the new health lattice with real writes:

1. fixed `sign` producer continued posting `HEALTHY` every ~30 seconds;
2. office heartbeat posted `AUTH_DEGRADED` while the local Eufy bridge was down;
3. the persisted bridge was restarted and reported `auth=ok`, `pushConnected=true`, `sessionLost=false`;
4. the next office heartbeat transitioned `AUTH_DEGRADED -> MEDIA_DEGRADED`.

That is end-to-end evidence that an office/PTZ transport fault no longer contaminates fixed vehicle truth.

### NattyNour interim observer

NattyNour now has a scoped office-health observer:
- secrets are DPAPI-protected under the current Windows user; plaintext user-environment copies were cleared;
- `StateNour-Eufy-OfficeHealth` is a restart-capable scheduled task and is running;
- `StateNour-Eufy-Bridge` is registered for logon persistence;
- the observer connects the semantic-event WebSocket and posts a production camera heartbeat every 30 seconds;
- `EUFY_CONTROL_ENABLED=0` on NattyNour, intentionally: this host must not claim PTZ commands while it is off the office camera's LAN.

This observer is useful operational truth, but it is not the final control host.


Persistent production row receipt after the observer had advanced:
- office `heartbeatSeq=7`, `mode=SHADOW`, `sourceConnected=1`;
- `authPlaneOk=1`, `eventPlaneOk=1`, `mediaPlaneOk=0`;
- `controlPlaneOk=NULL`, `ptzHomeOk=NULL`;
- all four proof timestamps were still NULL, including `lastEventProofAt`: the bridge WebSocket is connected, but a real office motion/person event has not yet been observed;
- fixed `sign` was independently at `heartbeatSeq=1651`, `mode=PRODUCTION`.


### Remaining office-camera boundary

The office T8410 still needs its bridge/media worker moved onto the shop-side Windows host
`DESKTOP-VBAHM60` (or an explicitly engineered subnet route). That peer is online on the
tailnet and exposes RDP/SMB, but it is not advertising the camera's `192.168.0.0/24` subnet
and NattyNour does not have authenticated remote-admin access to it.

Do not promote office PTZ/media/home to LIVE until the shop-side host produces:
- real office motion/person receipt,
- successful media byte read,
- bounded PTZ command,
- unsolicited `ptzNotify`,
- visual/SceneLock confirmation of the calibrated home view.

Audio capture remains behind the existing explicit policy/notice gate and verified media source.
