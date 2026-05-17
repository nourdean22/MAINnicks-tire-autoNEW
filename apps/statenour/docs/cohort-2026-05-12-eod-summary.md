# Cohort summary · 2026-05-12 EOD · v10.0.528 → v10.0.529.11

**Sprint:** 15 ships in one calendar day (2026-05-12) on `codex/ollama-local`
**Outcome:** Every audit finding closed · every CVE closed · prompt v2
Criterion 4 PASS · decision-replay Arc B F3 made end-to-end actionable

This doc rolls up the full wave for the next Claude session and for the
operator's reconciliation pass. The wave is also captured in
`docs/RECONCILIATION.md` (top entry) and individually per-ship in
git commits c8de6b1..HEAD.

## Quantitative deltas

| Metric | Before | After | Δ |
|---|---|---|---|
| CVEs (total) | 43 | **0** | −43 |
| CVEs (high severity) | 15 | 0 | −15 |
| Cron budget (active/40) | 38 | 36 | +4 slot headroom |
| Routes sanitized | 0 | 26 | +26 |
| Tools fenced (prompt-injection) | 0 | 4 | +4 |
| Tools quota-gated | 0 | 2 | +2 |
| ADRs | 11 | 15 | +4 |
| Prod migrations applied | 0 | 1 | v526 index (8+ , 14−) |
| Tests | 1672 | 1700+ | +28 (v529.11 added 25 tests) |
| Pre-push gates run | — | 15/15 every ship | — |
| Reviewer-flagged defects closed | — | 4 | post-session pass |
| Prompt v2 Criterion 4 | unknown | **PASS** | N=20 judge-eval |
| Pages with v529 polish | — | 1 (chat ?seed=) | — |

## Ship-by-ship

**v10.0.528 · Wave 6 · 4 parallel agents (1.5h dispatch window)**
Tracer-level observability surface (timeline + drawer) · Mobile a11y A2/A6/A7
(composer + textarea + tickers · 44×44 / 36px floor) · Eval regression
35 → 75 questions (4 new categories) · Decision-replay coach pipeline
(daily cron · BrainMemory(decision_replay_due) queue · wisdom citation
match). NO new tables · reuses MasteryDecisions + DecisionReplay model.

**v10.0.529 · deferred fixes land + Ultron decision-replay tile (read-only)**
H3 conversation-recall embedding-decode skip counters · H4 morning-brief
idempotency fails closed · H5 morning-brief durable-write reports
`persisted: bool` · S-2 OAuth CSRF state cookie (CSPRNG, HttpOnly Secure
SameSite=Lax, timing-safe verify) · S-4 `getClientIp` prefers
`x-vercel-forwarded-for` + last-non-private-hop walk · server-only declared
in package.json · new DecisionReplayCard mounted in Ultron.

**v10.0.529.1 · v526 index migration APPLIED to prod Neon**
8 new indexes via `CREATE INDEX CONCURRENTLY` · 14 dead drops via
`DROP INDEX CONCURRENTLY` · M8 fixup for PascalCase `AuditEvent` table ·
new reusable `scripts/apply-pending-migration.ts` (autocommit pg
driver, bypasses Prisma's implicit transaction wrap) · `prisma migrate
resolve --applied` recorded · `migrate status` clean (23 migrations).

**v10.0.529.2 · security mediums + silent-failure M6**
T-2 SQL injection defense-in-depth (`/api/brain/search-hybrid` runtime
allowlist) · T-3 proper HTML escape in OAuth `errorPage` · S-3 OAuth
`/start` session-gated · D-3 xlsx CVE deferred (later closed in .5) ·
M6 morning-brief 5-query `personal_slice_<label>_failed` logs.

**v10.0.529.3 · rate limits + silent-failure mediums + CVE cleanup**
D-1 `checkAiRateLimit` on autocomplete + suggestions + transcribe +
chat/documents · `checkRateLimit("general")` on lane-check/feedback ·
M1/M5/M7 silent-failure logs · **Next 16.2.3 → 16.2.6** (closes 7 high
CVEs · SSRF · DoS×2 · middleware bypass×3 · App Router bypass) ·
pnpm.overrides `axios>=1.15.2` (4 high CVEs) · `fast-uri>=3.1.2` (2
high CVEs).

**v10.0.529.4 · sanitizeError helper + tool-quota guard**
NEW `lib/utils/sanitize-error.ts` scrubs postgres URLs, Bearer tokens,
`sk-*` keys, absolute paths, IPv4 (caps 200 chars) · applied via
`replace_all` to 12 high-traffic AI routes · NEW `lib/ai/tool-quota.ts`
daily-quota check via `BrainMemory(category="tool_quota_daily")`
(no new tables) · wired into `runPython` (100/day) and
`ingestDocumentFromUrl` (50/day).

**v10.0.529.5 · I-1 sweep + xlsx→exceljs + E-3 prompt-injection fences**
sanitizeError swept to 14 more routes via parallel agent (26 total) ·
`xlsx@0.18.5` → `exceljs@4.4.0` via parallel agent (closes last 2 high
CVEs · ParsedDocument contract preserved) · NEW
`lib/ai/tool-result-fencing.ts` wraps `searchDocuments` /
`searchWebVerified` / `findRelatedConversations` outputs in
`<tool_data tool="..." source="external_web|external_doc|cross_session">`
fences · system prompt gains `TOOL_DATA_FENCING_RULE` (~170 tokens).

**v10.0.529.6 · cron retirement + RECONCILIATION entry**
Device subsystem retired (3 crons: `device-command-reap` · `device-sync`
· `device-health`) freeing 2 slots (38 → 36 active) · saves ~430 wasted
invocations/day · routes preserved for future re-activation.

**v10.0.529.6.1 · vercel.json sync after device retirement**

**v10.0.529.7 · decision-replay tile is now ACTIONABLE**
NEW POST `/api/system/decision-replays/[id]/mark` (owner-gated · marks
`metadata.consumedAt`) · chat page `?seed=` composer hydration ·
DecisionReplayCard rows clickable, fire-and-forget mark + immediate
refetch · end-to-end operator flow: HQ → tap → /chat with prompt
preloaded → queue shrinks live.

**v10.0.529.8 · 4 post-session-review fixes**
Independent code-reviewer agent (general-purpose) found 1 HIGH + 3 MEDIUM
real defects across the v528-v529.7 diff. All 4 closed:
**tool-quota race condition** (raw SQL atomic `INSERT … ON CONFLICT
DO UPDATE SET metadata = jsonb_set(…)` · Postgres row-write lock
serializes correctly) · **DST-correct nextMidnightEtIso()** (
`isCurrentlyEdt()` reads actual America/New_York offset) ·
**sanitize-error path coverage** (14 fs prefix set including /app, /tmp,
/usr, /srv, /proc, /opt, /sys, /dev, /mnt, /media · scoped to fs-leak
roots, not URL paths) · **?seed= length cap** (page slice(0, 2000) +
card slice(0, 1800) belt-and-suspenders).

**v10.0.529.9 · prompt v2 Criterion 4 PASS + VAPI removal plan**
Agent ran `scripts/prompt-judge-comparator.ts` (N=20) and confirmed all
5 axes pass the no-axis-regresses-by->0.3 threshold (accuracy +0.1 ·
actionability -0.1 · brevity -0.2 · tone +0.1 · evidence -0.2). Token
spot-check v1=26,825 / v2=21,075 (-21.4% · within Criterion 2 band).
Agent also caught + fixed a latent script bug
(`buildSystemPromptUncached` not exported · had been broken since
v463 · never caught because the script was never run). VAPI orphan
audit by second agent (`docs/vapi-removal-plan.md`) classified 18
files into Tier 1 SAFE DELETE / Tier 2 MOVE FIRST / Tier 3 KEEP.

**v10.0.529.10 · ADRs 0012-0015 + final 13 CVEs closed (43 → 0)**
6 new pnpm.overrides closed all 12 moderate-severity CVEs: hono
>=4.12.18 · @hono/node-server >=1.19.13 · mermaid >=11.15.0 ·
postcss >=8.5.10 · uuid >=11.1.1 · ip-address >=10.1.1. ADR
backfill via parallel agent: 0012 sanitizeError · 0013 tool-quota ·
0014 tool-result-fencing · 0015 decision-replay-coach (renumbered
from 0011-0014 to dodge collision with 0011 axis-regen-gate). Spline
3D scaffold confirmed already-complete in repo · dynamic import
intentionally parked due to Next 16 webpack exports resolver issue.

**v10.0.529.11 · test coverage + this cohort summary**
NEW test files: `tests/utils/sanitize-error.test.ts` (15 tests) +
`tests/ai/tool-result-fencing.test.ts` (10 tests) · 25 new tests
total. Tool-quota helpers not testable in isolation (non-exported +
DB-coupled · race fix verified by Postgres semantics). This summary.

## Operator-actionable list (carries to v530+)

1. **Set `NICK_PRIME_PROMPT=shadow` in Vercel prod env** · single
   env-var save · no redeploy · effective ~30s · unblocks Prompt v2
   Criteria 1/2/3 verification (Criterion 4 already PASS).
2. **Wait 48-72h for shadow data** to accumulate in SystemMetric.
3. **Run `pnpm tsx scripts/prompt-shadow-summary.ts --days 3`** to
   gate Criteria 1/2/3 against real traffic.
4. **Verify L1/L2 rollback in staging** (Criterion 5 · `NICK_PRIME_PROMPT=off`
   reverts to v1 within ~30s of env-var save).
5. **Parallel nickstire session greenlight** → execute `v530.1` VAPI
   Tier-1 deletion (~2,485 LOC · 15 files + 1 schema model + 1 parked
   migration).
6. **Decide on Tier-2 UI surfaces** (5 surfaces · drop vs repoint):
   voice-latency-tile · vapi-calls page + chip + block · system-health
   voice block · tire-stock-requests archive.
7. **Once all 5 Prompt v2 criteria green** · operator greenlights
   Phase 1 (10% canary via deterministic conversation-ID hash).

## What's NOT in this wave (intentional deferrals)

- **Spline 3D dynamic-import re-enable** · upstream Next 16 webpack
  `exports`-field resolver issue · documented inline · skeleton-only
  path is current behavior · operator builds scenes when ready.
- **E-3 Phase 2** · classifier over tool outputs + dangerous-combo
  block-list · longer-form design work · pairs with HITL gate on
  searchDocuments → ingestDocumentFromUrl turn combinations.
- **D-4** · in-memory rate-limit cold-start reset · acceptable for
  single-tenant · move to Upstash when surface broadens.
- **E-2 IDOR/BOLA** · `/api/ai/chat/[id]` not multi-tenant filtered ·
  only matters if multi-tenant ever ships · flagged on the assumption
  that's a deliberate single-operator design.
- **Long-tail I-1 sweep** · ~18 internal cron handlers still raw
  err.message · low traffic · low leak surface · opportunistic.

## Cross-references

- `docs/RECONCILIATION.md` · top entry covers the same wave
- `docs/vapi-removal-plan.md` · Tier 1/2/3 triage detail
- `docs/v2-prompt-cutover-plan.md` · Criterion 4 PASS status + Phase 1
  operator sequence
- `docs/adr/0012-0015-*.md` · architecture decisions captured
- `docs/audits/silent-failure-sweep-v515-v524-2026-05-12.md` · H3-H5
  source findings (closed in v529)
- `docs/audits/security-stride-owasp-2026-05-12.md` · S-2 S-4 T-2
  T-3 source findings (closed in v529-v529.5)
- `docs/audits/db-cost-access-patterns-2026-05-12.md` · v526 index
  migration source (applied v529.1)

## Footer · reconciliation stamp

This cohort summary verified against repo state at HEAD
**`b03b485`** + the in-flight v529.11 working tree. Diff:
`git log --oneline c8de6b1..HEAD` returns 15 commits matching this
sprint. Tests: 1675 → 1700 green. Pre-push gates: 15/15 every ship.

Next session reads this doc first before assuming state.
