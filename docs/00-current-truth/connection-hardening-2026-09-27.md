# Connection hardening closeout — 2026-09-27

> Re-verify live systems before acting. This is a dated receipt, not a permanent assumption.

## Final merge receipt

PR #2721 squash-merged to `main` as `1ab0063f523e0761d5e9e2c4f02ed12d8966b41d` after the corrected closeout passed affected CI, authenticated StateNour E2E, Completion Authority, Adoption gates, Agent Policy, Admin diagnostic, Secret Scanning, and security. The four earlier review findings were fixed and formally resolved. #2721 is documentation/memory-only, so Nick production deployment truth remains #2720 (`a3b3555e43e755f0a90b12fc6962be2340e21503`) unless a later deployment receipt supersedes it.

## Closed and verified

- Nick production's source-code deployment is `a3b3555e43e755f0a90b12fc6962be2340e21503` (#2720). Repository `main` was already later at `128eb207a4f01b9da5bfbbb330733262357e421f` (#2719, docs-only) when this closeout branch was based, and #2721 later merged docs/memory-only as `1ab0063f523e0761d5e9e2c4f02ed12d8966b41d`. Do not use the deployed parent as the current repository HEAD.
- Nick's production health endpoint is healthy; database, critical schema, and self-healing checks are up.
- TiDB quota/connectivity is no longer the blocking incident.
- Camera-health state evaluation, durable claim, retry, and recovery-state logic are live. A real `sign=DEGRADED_VISION` transition and later `sign=HEALTHY` recovery were persisted. This proves state transitions, not that a real degradation/recovery pair reached the owner externally.
- Telegram is configured as the independent owner-alert fallback when email/webhook delivery is unavailable.
- The `sign` fixed-geometry camera is current and healthy.
- NattyNour's Eufy bridge and office-health daemon are running under the watchdog.
- Tailscale reaches the shop PC. Tests from both NattyNour and NicksMax initially used DERP, then established direct peer paths; this is normal fallback/NAT traversal, not an outage.
- The stale `right` camera row is legacy runtime residue, not current expected topology. `shared/cameras.ts` commissions only `sign`; `inside` and `office` remain intentionally uncommissioned.

## Deliberately incomplete — operator/external gates

### Office Eufy commissioning

Production currently shows `office` as fresh `SHADOW / MEDIA_DEGRADED`: authentication is proven and the semantic-event WebSocket is connected, but no real office motion/person event has yet produced `lastEventProofAt`. Control, media, PTZ-notify, and calibrated-home proof are also incomplete. This is expected before shop-LAN commissioning.
The current shop-side bootstrap bundle was already delivered to the shop PC. Completion requires local elevation and locally entered Eufy / StateNour / camera-ingest credentials. Do not move those secrets through chat.

Before commissioning, require all of these physical receipts: a real office motion/person event, successful media byte read, bounded PTZ command, unsolicited `ptzNotify`, and visual/SceneLock confirmation of the calibrated home view.

### Real camera-alert owner delivery

The production alert rail has proven detection, claim, retry, and recovery-state behavior. Resend rejected the observed real production page while the domain was unverified, and logger-only fallback correctly did not count as delivery. PR #2715 added Telegram fallback and #2720 added a manual provider self-test, but a provider-accepted **real production degradation alert plus its recovery delivery** has not yet been observed. Keep this open until that pair has external acceptance receipts.

### NicksMax hostname / reboot / ESU

**Updated receipt 2026-09-28:** the Windows rename/reboot portion is complete. The active hostname is now `nicksmax` (pending computer name `NICKSMAX`), and CBS, Windows Update, and PendingFileRename reboot flags are all clear.

- The current ESU licensing-preparation package KB5126256 is installed.
- Consumer ESU remains **not enrolled** (`ESUEnrollmentStatus` is empty; eligibility metadata is present).
- `C:\Users\nourd\NicksMax\ACTIVE-WORK.md` still exists and says not to reboot or touch V380/camera startup while the sibling camera session is active. Treat the guard as authoritative until that owning session clears it, even though a reboot has already occurred since the older snapshot.
- Remaining workstation action is the Microsoft-account / Windows Update consumer-ESU enrollment flow plus a post-enrollment receipt. No additional hostname reboot is currently required.

### Resend sending-domain DNS

Resend reports `nickstire.org` verification as `failed`. Public DNS confirms the required records are absent. Authoritative DNS is `ns1.globaldomaingroup.com` / `ns2.globaldomaingroup.com`.

Required Resend records at this snapshot:
- TXT `resend._domainkey`: use the current DKIM value shown by Resend.
- MX `send` -> `feedback-smtp.us-east-1.amazonses.com`, priority 10.
- TXT `send` -> `v=spf1 include:amazonses.com ~all`.

No connected DNS-management authority for Global Domain Group is available in this session. Add the records at the authoritative provider, then trigger Resend verification.

## Concurrency / cleanup boundary

Do not reboot NicksMax, kill V380, change camera startup, or delete camera/Eufy worktrees while the active camera-session guard exists. Other isolated active worktrees (including the Reel CTA contract work) are not reconciliation backlog and must not be reset or merged blindly.

## 2026-09-28 · NicksMax direct-cloud camera cutover — LIVE + VERIFIED

The `sign` camera authority has moved from the earlier GUI/WGC path to NicksMax's direct V380 cloud/P2P RTSP lane.

Verified production receipts:
- `camera_runtime.sign.sourceType = rtsp`
- calibration `sha256:67f719cc875d`
- live state `HEALTHY`
- fresh frame and healthy-frame timestamps
- production heartbeats continued HEALTHY with the V380 desktop application closed
- force-killing the production edge caused the supervisor to create a new producer instance automatically; the replacement returned HEALTHY
- the legacy `right` producer remains retired
- old NicksMax WGC producer/watchdog tasks remain disabled

The current local chain is V380 cloud/P2P -> local three-lens RTSP relay -> middle fixed-lens crop -> loopback MediaMTX -> OpenVINO edge producer. This removes the dependency on NattyNour, the shop PC, and the V380 desktop GUI for the commissioned `sign` lane.

The one remaining host-level limitation is pre-login boot recovery: the hardened supervisor is a current-user logon task because the remote shell is not elevated enough to register a SYSTEM startup task. This does not affect normal continuous operation or crash recovery after login.
