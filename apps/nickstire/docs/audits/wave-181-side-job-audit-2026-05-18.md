# Wave-181 side-job audit · 2026-05-18 PM

5 parallel read-only audits ran on the wave-181.x commits that landed
between Phase J's numbered phases (the "side jobs"). All audits used
the find-bugs 5-phase protocol + silent-failure-hunter + production-
code-audit + kaizen quality bar. Findings ranked by confidence + impact.

## Audits run

| Audit | Scope | Verdict |
|---|---|---|
| #1 | wave-181.50 (VAPI webhook routing) + wave-181.60 (SMS routing default flip + 8 fixes) | NEEDS-FIX |
| #2 | wave-181.58 (5 CRITICAL fixes from 4-agent production audit) | NEEDS-FIX |
| #3 | wave-181.54 (4-file delete) + wave-181.55 (199-page prerender delete) | NEEDS-FOLLOWUP (operational) |
| #4 | wave-181.59 (6 surgical fixes) + a03b8806 (OTP cleanup) + 73b600ff (zod-bind) | SOUND |
| #5 | wave-181.51 (SMS instrumentation · ~700 LOC) | NEEDS-FIX |

## Fixes shipped (6 surgical edits)

| # | File | Issue | Confidence | Fix |
|---|---|---|---|---|
| 1 | `server/cron/jobs/crossSellOutreach.ts:42` | Twilio env guard early-returned, blocking the F25e shop-gateway send path (Twilio dead per operator · vars intentionally unset on Railway) | 90% | Removed guard · all sends below use `{ via: "shop" }` so no Twilio creds needed |
| 2 | `server/cron/jobs/retentionSequences.ts:147` | Same Twilio env guard blocking all 6 retention tiers (D7/D14/D45/D90/D180/D365) | 90% | Same fix · removed guard |
| 3 | `server/sms.ts:706` | Shop-gateway fast path bypassed TCPA opt-out check + 24h rate-limit · opted-out customers received SMS until cache caught up | 82% | Moved opt-out + rate-limit checks BEFORE the gateway-routing branch so both paths enforce them |
| 4 | `server/services/vapi.ts:1558` | `buildFollowUpAssistantConfig()` was missing the nested `server: {url, timeoutSeconds}` field · inbound assistant was fixed in wave-181.50 but follow-up missed · next `updateFollowUpAssistant()` PATCH would silently drop webhook config | 95% | Added matching `server: serverUrl ? {url, timeoutSeconds: 20} : undefined` field |
| 5 | `server/routers/smsPerformance.ts:217` | `recentSends` returned full phone in spread alongside `phoneSuffix` · admin client never rendered it but PII was on the wire | 95% | Destructured `phone` out of spread · only masked suffix is serialized |
| 6 | `server/services/smsInstrumentation.ts:230` | `logOutboundSms` did exact-match conversation lookup on un-normalized phone · two different format inputs would create distinct conversation rows, breaking reply attribution | 88% | Apply `normalizePhone()` before lookup/insert (matches the read-side `RIGHT(REPLACE(...), 10)` normalization) |

## Findings deferred (not shipping in this pass)

These are real but lower-priority · either pre-existing patterns, operational items, or admin-gated low-real-risk surfaces.

| File | Finding | Why deferred |
|---|---|---|
| `server/cron/jobs/declinedWorkRecovery.ts:252` | `affectedRows` extraction falls back to `?? 0` on unrecognized result shape · silent non-send on Drizzle/mysql2 result-shape change | Safe-by-default (no double-send) · only fires if Drizzle output shape changes · low likelihood |
| `server/routers/advanced/portal.ts:113` | OTP stored + compared in plaintext · DB compromise exposes live codes | Pre-existing design gap · brute-force guard from a03b8806 is primary mitigation · separate hardening sprint |
| `server/routers/smsPerformance.ts:127` | `summary30d` fail-open returns `{tiers: []}` on error · UI cannot distinguish DB outage from genuine empty data | Admin-only view · workaround is to check error banner from `recentSends` (which DOES error correctly) |
| `server/routers/smsPerformance.ts:212` | `tier` input is `z.string().optional()` · unbounded LIKE pattern · admin can inject `%` wildcards for full-table scan | Admin-gated · low real-world risk · easy follow-up: replace with `z.enum([...])` allowlist |
| `server/services/smsInstrumentation.ts:77` | `recordSmsReply` race · two near-simultaneous inbound SMS both set `firstReplyAt=now` redundantly | Harmless · `replyCount` uses atomic SQL increment · `firstReplyAt` just gets whichever-wins value |
| `server/cron/scheduler.ts` (retention-all) | Daily one-shot tier · Railway restart at off-hours misses that day's send window for 24h | Pre-existing architectural pattern · belongs in scheduler-redesign sprint |
| `server/follow-ups.ts:66` | `followUp24hSent: 1` set even when send fails · booking never retried | Pre-existing · separate fix needs explicit retry queue |
| `apps/nickstire/prerendered/` | Wave-181.55 deleted 199 broken pages but didn't follow up with `pnpm run regen` · 199 routes fall through to SPA shell (still serves content, just slower for bots) | Operational · run regen during next prerender pass · also fixes bundle-hash mismatch on kept blog pages |

## Sibling-bug hints (NOT to fix · just flagged)

- `server/cron/jobs/warrantyAlerts.ts` · check for same Twilio env guard pattern
- `server/cron/jobs/crossSellOutreach.ts:73-78` · opt-out check inside per-rec loop = N+1 (capped at MAX_SMS_PER_RUN=10 · low urgency · matches the fix pattern in `staleLeadFollowup` + `declinedWorkRecovery`)
- `server/services/sms-scheduler.ts:176` · orphan "processing" rows after crash · pre-existing crash-safety gap

## Methodology

Per CLAUDE.md SUBAGENT POLICY · 5 read-only `feature-dev:code-reviewer`
subagents launched in parallel, each scoped to a specific commit
cluster. Each received the kaizen + karpathy + find-bugs quality bar
explicit in the prompt. Findings cross-checked against actual file
contents (Read tool · NOT trusting agent summaries) before shipping
any fix. Agent skips stylistic · only real bugs reported.

## Phase JJ shipped in same wave

While the audits ran, Phase JJ migrated `MessageEditControls` to tRPC
(`trpc.chat.editMessage` mutation + `utils.chat.editHistory.fetch()`
imperative on-click query). Introduced the **imperative-fetch-via-utils**
pattern · the 6th architectural pattern in the J series. J now at
17/50+ surfaces · chat router at 9 procedures (4 mutations).
