# Connection hardening closeout Ã¢â‚¬â€ 2026-09-27

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
- NicksMax is the Office Eufy bridge/agent/watchdog authority; NattyNour's old OfficeHealth producer is disabled.
- Tailscale reaches the shop PC. Tests from both NattyNour and NicksMax initially used DERP, then established direct peer paths; this is normal fallback/NAT traversal, not an outage.
- The stale camera row is legacy runtime residue, not current expected topology. shared/cameras.ts now commissions sign and office; only inside remains intentionally uncommissioned.

## Deliberately incomplete Ã¢â‚¬â€ operator/external gates

### Office Eufy commissioning

Office is commissioned and the NicksMax producer emits `PRODUCTION` heartbeats against **NICKS EUCLID** (`T8410P5225154105`). `Moes Euclid Office` (`T8410P522517180B`) is the old/legacy shared device and is not the production Office target.

Current live receipts:
- authenticated bridge sees NICKS EUCLID with video/RTSP/PTZ/audio and motion/person capabilities;
- NicksMax event stream is connected and receives `streamState` for `T8410P5225154105`;
- real media-byte probe succeeds (`mediaPlaneOk=true`, proof at 2026-09-29T00:20:11.894521Z);
- Nick backend transitioned Office from `MEDIA_DEGRADED` to `UNVERIFIED_CAPABILITIES` at corrected producer seq=1 (00:19:11Z), then continuously accepted the corrected producer through at least seq=16 at 00:28:15Z.

`UNVERIFIED_CAPABILITIES` is the truthful remaining boundary: a real semantic motion/person event, fresh control/PTZ receipt, and NICKS-EUCLID-specific calibrated-home proof are still required. Do not reuse old Moes media failures, PTZ receipts, or visual-home references for the current camera.
### Real camera-alert owner delivery

The production alert rail has proven detection, claim, retry, and recovery-state behavior. Resend rejected the observed real production page while the domain was unverified, and logger-only fallback correctly did not count as delivery. PR #2715 added Telegram fallback and #2720 added a manual provider self-test, but a provider-accepted **real production degradation alert plus its recovery delivery** has not yet been observed. Keep this open until that pair has external acceptance receipts.

### NicksMax camera authority / reboot / ESU

**Updated receipt 2026-10-02 (#2896):** a real cold boot happened at 09:15 ET.
- **SYSTEM supervisor:** came up in Session 0 (loop pid 2656). Cold-boot persistence for the sign lane is now observed, not just claimed.
- **`NicksMaxCameraSupervisorUser`:** was **Running again** (not disabled), so two supervisor loops fought over the relay. It is disabled again, and the supervisor now keeps it on its retired-task list.
- **Office conversation worker:** failed at every boot because its SYSTEM task pointed into a cleaned-up git worktree. The supervisor now repoints it to `NOURCITY\camera-bridge` and restarts it when stopped or when its heartbeat is stale.
- **Single source:** the supervisor lives in `camera-bridge/scripts/nicksmax/`; `data\` holds a shim with a last-known-good fallback. NicksMax tracks `main`.

**Updated receipt 2026-09-28:** the earlier sibling-session camera guard is superseded. NicksMax now owns the lightweight production `sign` camera-processing lane.

- The V380 desktop GUI is not a production dependency and was absent during final verification.
- The live path is native V380 cloud relay `:8554` -> FFmpeg SHOPSIGN crop -> MediaMTX `rtsp://127.0.0.1:8555/sign` -> production OpenVINO `edge_main.py` with `calib-nicksmax-sign-rtsp.json` (SHA256 `67F719CC875DEE8B0EFF9B246428CE9840530FB0921FA9BCC1FFB8803D502258`).
- `NicksMaxCameraSupervisorUser` is disabled. The production supervisor and edge tree run in Windows Session 0; legacy WGC/V380-watchdog and shadow-candidate tasks remain disabled.
- Self-heal is live-proven: the old Session-1 production tree was killed while the user supervisor was disabled; Session 0 recreated the production wrapper at 18:27:11 ET and Python/OpenVINO edge processes at 18:27:12 ET.
- Railway accepted the restarted producer beginning at 22:27:38Z with `sign seq=1 accepted state=HEALTHY`, followed by seq=2 and seq=3 HEALTHY.
- Locked-screen independence is live-proven: with Windows locked and the V380 GUI absent, Railway continued accepting HEALTHY heartbeats through at least seq=8 at 22:31:08Z.
- Cold-boot persistence after the SYSTEM-supervisor cutover is **not yet live-proven**. The remote-control layer blocked restart/shutdown. A later controlled reboot must observe Session-0 startup plus fresh Railway camera heartbeats before login. **Update 2026-10-07:** Session-0 startup after a Windows start was observed on 2026-10-02 09:15 ET and 2026-10-03 13:56:58 ET (chain back by 13:58:52 under SYSTEM); the login-free Railway heartbeat receipt is still unrecorded, so this stays observed-twice, not proven.
- C: had about 2.53 GB free (6.3%) at closeout. Camera logs/DBs were small; active worktrees were deliberately not deleted.
- Hostname/reboot servicing from the earlier workstation setup is complete. Consumer ESU remains **not enrolled**; that is a separate operator/account action.

### Resend sending-domain DNS

Resend reports `nickstire.org` verification as `failed`. Public DNS confirms the required records are absent. Authoritative DNS is `ns1.globaldomaingroup.com` / `ns2.globaldomaingroup.com`.

Required Resend records at this snapshot:
- TXT `resend._domainkey`: use the current DKIM value shown by Resend.
- MX `send` -> `feedback-smtp.us-east-1.amazonses.com`, priority 10.
- TXT `send` -> `v=spf1 include:amazonses.com ~all`.

No connected DNS-management authority for Global Domain Group is available in this session. Add the records at the authoritative provider, then trigger Resend verification.

## Concurrency / cleanup boundary

The camera sibling-session guard is closed for this workstream. Do not reintroduce the V380 GUI/WGC as a production dependency or re-enable the interactive camera supervisor while the Session-0 lane is healthy. A future reboot is allowed only when it will not disrupt other active sessions, and must be used to capture the still-missing cold-boot camera receipt (as of 2026-10-07 two boots have been observed, Oct 2 and Oct 3, but the login-free Railway heartbeat receipt is still unrecorded). Other isolated active worktrees are not reconciliation backlog and must not be reset or merged blindly.
