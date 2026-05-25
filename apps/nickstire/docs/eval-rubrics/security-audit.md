# Security Audit Protocol

**Skill port:** B14 · security-audit + the audit-fix two-session discipline
**Applies to:** every quarterly security pass · every "operator suspects something is wrong" investigation · every post-incident structural review.
**Authored:** 2026-05-26.

## Why this doc exists

The 2026-05-25 audit-fix session shipped 27 ports + closed 4 audit regressions in one auto-run because it followed a two-session discipline: one session AUDITED with no edit permission, one session FIXED based on the audit's report. Without that discipline, audits become "while I'm here I'll just fix this one thing" · scope creeps · fixes ship without verification · and the audit's catalog of findings is never closed out cleanly.

This doc codifies that protocol so the next audit doesn't restart from scratch. It also enumerates the 8 security domains the audit must cover · skipping domains is how 0-days hide.

## The two-session audit-fix protocol

### Session A · Audit (read-only · no edits)

Working directory · `~/<repo>-readonly-audit/` (a separate clone · NOT the active dev tree).

Prompt to the audit session:

```
You are running a security + quality audit. READ ONLY.
You must NOT modify any file. You must NOT run pnpm install / git pull / etc.
Output is a numbered list of findings with file:line references.
For each finding: severity (P0/P1/P2/P3) + category + 1-line description + remediation hint.
When you complete a sweep, post the report and STOP. Do not start another sweep.
```

The audit's deliverable · a markdown report at `audit-2026-MM-DD.md` with:
- Finding count by severity
- One section per category (security · correctness · perf · UX · brand · audit-discipline)
- Each finding numbered `#NNN` for cross-referencing in fix-session commits

### Session B · Fix (write · references audit by ID)

Working directory · `~/<repo>/` (the live dev tree).

Prompt to the fix session:

```
You have an audit report at <path>. You may ONLY fix findings present
in that report. Each commit must reference finding IDs (e.g. "wave-X fix #182 #183 #184").
You may NOT introduce changes that weren't in the audit · scope creep
is rejected at PR time.
For each fix · verify the actual file shows the bug before fixing · audit
verifiers hallucinate. Spot-check 1-2 of every category.
```

The fix session's deliverable · waves of commits, each referencing audit IDs, each verified before push.

### Why two sessions matters

**Auditor blindness** · the agent that wrote the bug can't see it. Fresh eyes (a separate session, separate working tree) find what familiarity hides.
**Scope guardrails** · "while I'm here let me also..." kills delivery. The audit IS the scope · nothing else ships in the fix wave.
**Verifier discipline** · audits hallucinate. The fix session verifies the bug exists BEFORE shipping the fix. The May 25 run caught 2 hallucinated findings (#157 serviceFeePerTire false default · smsBot optOutSet "dead code") this way.
**Closed-loop tracking** · audit IDs → commit messages → ledger. 6 months later you can answer "what was open at the time of incident X."

## The 8 security domains

Skip none. Each domain has a 5-question checklist.

### Domain 1 · Input validation (zod + schema discipline)

1. Every external input (HTTP body · query · header · webhook payload) goes through zod
2. Numbers have `.min()` + `.max()`
3. Strings have `.max()`
4. Enums are `z.enum()`, not free-string
5. Output schemas on read procedures catch shape drift

Cross-references · `docs/eval-rubrics/trpc-zod-discipline.md` (the canonical zod rules).

### Domain 2 · Authentication + session

1. Every protected route checks session BEFORE doing work
2. Admin routes additionally check role (operator vs staff)
3. Session timeout configured · refresh discipline documented
4. Sign-in attempts rate-limited (per-IP + per-account)
5. Brute-force counter is **durable** (DB-backed, survives process restart) · not in-memory

Memory cross-ref · `otp_attempts` table (wave 181.60).

### Domain 3 · Authorization (the access-control matrix)

1. Per-resource ownership checks (`owner_id = session.userId`) on every mutation
2. No "trust the URL · the customer-id query-param wouldn't be tampered" patterns
3. Admin actions audit-logged with operator-id + timestamp
4. The audit-log table is APPEND-ONLY (no UPDATE / DELETE allowed) — separate audit-only schema/role
5. Token-based public-share URLs use UUID or signed JWT · not predictable IDs

### Domain 4 · Secrets + credentials

1. No secrets in source code (grep for `sk_` `ghp_` `xoxb-` `AIza` `AWS_` `=eyJ` etc.)
2. `.env.example` enumerates every secret · production-only secrets DOCUMENTED but never committed
3. Secret rotation is a documented runbook · not "we'll figure it out"
4. CI/CD logs never echo secrets (mask in scripts · use `set +x` around sensitive blocks)
5. Webhook secrets validated (HMAC) BEFORE processing payload

### Domain 5 · Output sanitization (XSS + injection prevention)

1. React handles HTML escaping · but ANY raw `dangerouslySetInnerHTML` audited
2. SMS templates don't interpolate user input without escaping
3. Email templates pass through DOMPurify or equivalent
4. SQL never built via string concat · parameterized queries only
5. Logs never echo full user input · PII patterns redacted before logging (cross-ref `scripts/lint-pii.mjs`)

### Domain 6 · CSP + headers (defense-in-depth)

1. CSP `connect-src` enumerates every domain the app talks to (cross-ref nickstire vite.config.ts · statenour next.config.ts)
2. `Strict-Transport-Security` header set on every prod response
3. `X-Frame-Options: DENY` (unless explicit iframe embed allow-listed)
4. `X-Content-Type-Options: nosniff`
5. `Referrer-Policy: strict-origin-when-cross-origin`

### Domain 7 · Rate-limiting + abuse prevention

1. Per-IP rate limit on auth + signup endpoints
2. Per-account daily-cap on SMS sends (the `daily_outbound_limit` pattern · audit #126)
3. Cron jobs respect global limits (no infinite-loop autonomous runs)
4. Photo/file uploads size-capped + MIME-validated
5. Webhook endpoints validate source (IP allowlist OR HMAC signature)

### Domain 8 · Third-party integration surface

1. Every API key has its OWN env var (no shared `API_KEY`)
2. API errors do NOT leak provider response bodies to the customer
3. Retries have circuit-breakers (cross-ref `withTimeout` + `withTimeoutOrFallback` in `packages/utils`)
4. Vendor outages have documented fallback (e.g. F25e SMS gateway fallback to Twilio)
5. Vendor data-handling reviewed annually (GDPR/CCPA/HIPAA-equiv if applicable)

## The audit-fix loop closure

Audit findings ARE the scope · the fix session can't expand. But the audit itself can MISS regressions introduced BY the fix session. That's the loop closure step:

```
Fix session ships wave-N → Audit session does delta-audit on wave-N changes
                       → Fix session ships fix-of-fix as wave-N+1
```

Examples from May 25 run · 4 audit regressions introduced by fix-session caught + closed in the same auto-run:
- #281 cron lock leak in `runJobByName` (Wave A introduced · same-session fixed)
- #283 statenour CSP missing api.vapi.ai (Wave E.2 introduced · same-session fixed)
- #301/302 4 missed SMS callsites without `{ via: "shop" }` (Wave E.2 partial · completed same-session)

Without delta-audit, these ship and become NEXT-quarter's audit findings · double work.

## Severity definitions

| Severity | Definition | SLA |
|---|---|---|
| **P0** | Customer-impacting · data exposure · service down OR fraud-enabling | Fix within 4 hours · operator paged |
| **P1** | Quality-impacting · could cause customer-impacting bug under specific conditions | Fix within 1 week |
| **P2** | Code-craft issue · doesn't impact customer today but compounds maintenance cost | Fix within 1 month OR document deferral |
| **P3** | Style · nit · suggestion · NOT a defect | Fix opportunistically OR ignore |

P3 findings should be RARE in a security audit. If half the findings are P3, the audit lost discipline · ask "what's the actual security delta?"

## Anti-patterns

### "Audit findings without remediation"

A finding without a fix idea is a wish. The audit session must propose a remediation hint · OR mark "needs design" if the fix is non-obvious. "Needs design" findings become standalone-session work · not fix-wave work.

### "Fix session does its own discovery"

The fix session is BOUND to the audit. If during fix-work the agent says "while I'm here let me audit X too" · STOP. That's a new audit, run it as session A. Mixing discovery into fix work is how scope creep + bugs ship together.

### "P0 not paged"

If the audit finds a P0 and the operator is asleep, the audit STOPS and pages. Continuing to audit while a P0 is open means the P0 lingers · audit completion is not more important than P0 closure.

### "Verifier hallucinations not caught"

The fix session must spot-check before shipping. "Audit says X is broken" · open the file · confirm X is actually broken in the line cited. The May 25 run caught 2 hallucinated findings this way. Skipping the spot-check ships broken fixes for non-bugs.

### "Audit cadence drift"

"We'll audit next quarter" becomes never. Set a calendar cron · audit-session prompt is in the calendar invite · "audit until P1+ count is < 5, then stop · don't expand scope."

## Implementation plan (queued)

1. Calendar cron · quarterly audit prompt with the audit-only protocol
2. Document the audit-fix two-session prompts in `docs/runbooks/audit-protocol.md` (separate runbook · this doc is the WHY · the runbook is the HOW)
3. Add `audit_findings` table · `id · severity · category · description · file_path · line · status · fixed_in_commit · created_at` · single source of truth across audits
4. Build statenour `/audits` page · roster of past audits + open findings + closed findings
5. Annual rotation · rotate which domain gets the "deep" audit (8 domains × quarterly = each gets 1 deep + 3 shallow per year)
6. Audit completion writes a CGD-formatted report (cross-ref clarity-gate skill) · ingestable into RAG · operator can search past findings

## Skill-port lineage

B14 from the audit's Round 2 + the operator-discovered two-session pattern from the May 25 auto-run. Pairs with:
- `docs/eval-rubrics/trpc-zod-discipline.md` (Domain 1 canonical rules)
- `docs/eval-rubrics/incident-response.md` (post-incident audits)
- `docs/eval-rubrics/autonomous-action-tiers.md` (audit is Tier-4 read-only · fix is Tier-2 reversible)
- `docs/eval-rubrics/code-craft-review.md` (correctness review companion · craft is the next pass after security)
- Wave Q + T + U lint discipline · catches lowest-tier domain 1/5 issues at pre-commit

Future · agentic auditor that runs the 8 domains nightly · writes findings to `audit_findings` table · operator sees the delta in `/audits`. Most findings would be P3/P2 · the P0/P1 surface gets paged.
