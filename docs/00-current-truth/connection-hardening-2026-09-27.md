# Connection hardening closeout — 2026-09-27

> Re-verify live systems before acting. This is a dated receipt, not a permanent assumption.

## Closed and verified

- Repo and production converge on `a3b3555e43e755f0a90b12fc6962be2340e21503` (#2720) at this pass.
- Nick's production health endpoint is healthy; database, critical schema, and self-healing checks are up.
- TiDB quota/connectivity is no longer the blocking incident.
- Camera health alerting is live. A real `sign=DEGRADED_VISION` transition and later `sign=HEALTHY` recovery were persisted.
- Telegram is configured as the independent owner-alert fallback when email/webhook delivery is unavailable.
- The `sign` fixed-geometry camera is current and healthy.
- NattyNour's Eufy bridge and office-health daemon are running under the watchdog.
- Tailscale reaches the shop PC. Tests from both NattyNour and NicksMax initially used DERP, then established direct peer paths; this is normal fallback/NAT traversal, not an outage.
- The stale `right` camera row is legacy runtime residue, not current expected topology. `shared/cameras.ts` commissions only `sign`; `inside` and `office` remain intentionally uncommissioned.

## Deliberately incomplete — operator/external gates

### Office Eufy commissioning

Production currently shows `office` as fresh `SHADOW / MEDIA_DEGRADED`: authentication and semantic event planes are proven, while control/media/home-pose proof is incomplete. This is expected before shop-LAN commissioning.
The current shop-side bootstrap bundle was already delivered to the shop PC. Completion requires local elevation and locally entered Eufy / StateNour / camera-ingest credentials. Do not move those secrets through chat.

### NicksMax final reboot + ESU

- Active hostname remains `DESKTOP-0MCRL1J`; pending hostname is already `NICKSMAX`.
- Windows has CBS, Windows Update, and PendingFileRename reboot flags.
- The current ESU licensing-preparation package KB5126256 is installed.
- The Windows profile has no linked Microsoft-account identity and consumer ESU is not yet enrolled.
- `C:\Users\nourd\NicksMax\ACTIVE-WORK.md` explicitly blocks reboot while the sibling V380/camera session is active.
- `finish-nicksmax` and the post-reboot verifier are already staged. After the camera guard is cleared: link/sign in the required Microsoft account, complete Windows Update's ESU enrollment flow, perform the controlled reboot, then verify hostname/Tailscale/Commander/SSH/ESU receipts.

### Resend sending-domain DNS

Resend reports `nickstire.org` verification as `failed`. Public DNS confirms the required records are absent. Authoritative DNS is `ns1.globaldomaingroup.com` / `ns2.globaldomaingroup.com`.

Required Resend records at this snapshot:
- TXT `resend._domainkey`: use the current DKIM value shown by Resend.
- MX `send` -> `feedback-smtp.us-east-1.amazonses.com`, priority 10.
- TXT `send` -> `v=spf1 include:amazonses.com ~all`.

No connected DNS-management authority for Global Domain Group is available in this session. Add the records at the authoritative provider, then trigger Resend verification.

## Concurrency / cleanup boundary

Do not reboot NicksMax, kill V380, change camera startup, or delete camera/Eufy worktrees while the active camera-session guard exists. Other isolated active worktrees (including the Reel CTA contract work) are not reconciliation backlog and must not be reset or merged blindly.
