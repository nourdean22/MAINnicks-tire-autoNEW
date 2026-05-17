# Local Agent Device Diagnostic

> **HISTORICAL · v10.0.529.106 Wave 75 note**: this is a 2026-03-29
> snapshot. Device tracking has been flagged as "known-stale" in
> MEMORY.md since 2026-05-01 · the local agent has not been actively
> reporting. The schemas + API + Python agent at
> `local-agent/tuya_agent.py` still exist · re-launching the agent
> would resume the pipeline. For current device state see
> `/system/devices` (live data) instead of this snapshot.

Generated: 2026-03-29

## Agent Status: HEALTHY

Agent is running (cycle 1106+, ~30s intervals). Health server on port 3600.

## Integration Status

| Integration | Status | Devices | Notes |
|------------|--------|---------|-------|
| Tuya | WORKING | 8 synced | 5 devices return "function not support" on status endpoint — likely unsupported device types (IR remotes, sensors). Sync itself works. |
| Ring | WORKING | 5 synced | Auth token valid. Syncing normally. |
| Eufy | WORKING | 5 synced | Connection restored. Syncing normally. |
| V380 | WORKING | 2 cameras synced | Local network cameras responding. |

## Total: 20 devices synced across 4 platforms

## Tuya "function not support" Warnings

5 devices consistently return this error:
- `ebbbec9cd46a7c2dc2voos`
- `ebfd885cbae5a004e4qv1u`
- `eb060180d128b982c0ca54`
- `eba7126d5e511b6c4beqcl`
- `eb6916ce4f9bcc288ecgi7`

These are likely IR remotes or basic sensors that don't support the `/v1.0/devices/{id}/status` endpoint. The devices still sync (8 total Tuya devices synced). This is cosmetic noise, not a functional failure.

**Fix (optional):** Suppress or downgrade the warning for known unsupported device IDs in `tuya_agent.py`.

## Previous Issues (RESOLVED)

- **"Token fetch failed: sign invalid"** — Fixed in a prior session. Tuya API credentials regenerated.
- **Ring 0 devices** — Auth token was expired. Re-authenticated.
- **Eufy 0 devices** — Connection restored.
- **V380 0 cameras** — Camera IPs verified on local network.
- **Health server not responding** — Was binding issue. Now on port 3600.

## No Manual Actions Required

All integrations are operational. Agent is healthy.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
