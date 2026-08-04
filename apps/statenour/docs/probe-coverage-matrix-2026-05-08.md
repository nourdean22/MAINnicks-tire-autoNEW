# Glitch taxonomy · probe coverage matrix · 2026-05-08

Closes ADR-0008's open item: "probe coverage matrix · which categories
have all 4 phases shipped vs partial." Snapshot taken at v10.0.470,
after the v10.0.445-469 prompt + motion + schema + ADR backfill wave.

The 4-phase prevention model from ADR-0008:
- **Phase 1 · Detect** — probe per category
- **Phase 2 · Surface** — finding routes to operator-visible places
- **Phase 3 · Prevent** — discipline that keeps the failure away
- **Phase 4 · Document** — taxonomy file + ADR + commit-message format

A category is "complete" when all 4 phases ship. "Partial" when only
some have. Open issues become probe-coverage tasks.

## The 8 categories · current state

| # | Category | Detect (Phase 1) | Surface (Phase 2) | Prevent (Phase 3) | Document (Phase 4) | Status |
|---|---|---|---|---|---|---|
| 1 | **Contract drift** | Bridge schema check (manual) | `correlation_alert` brain memories | Type-safe bridge envelopes (`lib/nickstire/query.ts`) | Taxonomy + commit "v10.0.x · contract drift fix" pattern | **PARTIAL** · auto-detection only on app-level (Prisma type drift). External APIs still require operator check. |
| 2 | **Silent failure** | `withGuardian` 9-category classification (ADR-0004) | `/system/observability` request tracer | `withGuardian` wrapper + v10.0.448 breadcrumb sweep | ADR-0004 + ADR-0008 | **COMPLETE** ✓ |
| 3 | **Template escape** | None automated · operator-caught (the v10.0.333 chat session that triggered the taxonomy) | None dedicated | Mustache-class parser audit · v10.0.x prompt-quality audit found no remaining escape paths | Taxonomy entry only | **PARTIAL** · prevent-side stable but no dedicated probe. |
| 4 | **Race / ordering** | None automated · concurrency-test gaps caught in code review | None dedicated | Idempotency keys (autonomous-event extraction · v10.0.5) · DB transactions · streaming-finish + verifier-rewrite race fixed v10.0.330-era | Taxonomy entry only | **PARTIAL** · prevention via patterns, no probe. |
| 5 | **Intent confusion** | Per-handler unit tests · operator-caught ("regen used complaint as prompt" was the trigger) | `judge-eval` 5-axis rubric flags low-evidence replies · `adversarial-critic` surfaces wrong-context recommendations | Tighter context-window selection · `lib/ai/chat/action-intent-detector.ts` | ADR-0008 + Glitch taxonomy + ADR-0009 (multi-agent lenses help avoid intent confusion via the research lens) | **COMPLETE** ✓ |
| 6 | **State drift** | `lib/services/runner-state.ts` reconciler · scheduled cron alerts | `/system/diagnostics` · `/system/cron-diagnostics` | Idempotent upserts + reconciler crons | Taxonomy + DB-MIGRATION-POLICY.md | **COMPLETE** ✓ |
| 7 | **Schema drift** | `scripts/schema-index-audit.ts` (v10.0.376) + `scripts/schema-timestamp-audit.ts` (v10.0.451 + v10.0.461) + (`scripts/schema-drift-check.sh` DELETED 2026-08-04 — it was never in any CI workflow or package script, and despite a `--dry-run` comment it actually ran `prisma db push --accept-data-loss` against whatever `DATABASE_URL` `.env.local` supplied) | operator-runnable scripts only; **no CI gate** | Migration policy · pre-push gate enforces `prisma format` clean | Taxonomy + DB-MIGRATION-POLICY.md + ADR-0006 (pgvector schema) + this matrix | **PARTIAL** — the two audit scripts run; drift detection is unautomated |
| 8 | **UI surface drift** | `scripts/audit-internal-links.ts` (v10.0.330 era) + `scripts/audit-sort-filter.mjs` (v10.0.441 + v10.0.444) | Script exits non-zero on dead link / classification mismatch | Cluster-merge cleanup waves caught dead routes (v10.0.330 cohort) | Taxonomy entry · 4 cluster-merge audit comments | **COMPLETE** ✓ |

## Net coverage

- **Complete (all 4 phases):** 5/8 — silent failure · intent confusion · state drift · schema drift · UI surface drift
- **Partial (prevent + document, no automated detect):** 3/8 — contract drift · template escape · race / ordering

## Open work surfaced by this matrix

The 3 partial categories are the next probe-coverage targets:

### Contract drift · gap = no auto-detection on external APIs

Today the bridge envelope shape is type-checked (Prisma types catch
internal drift). The bridge actions (`revenue_week`, `leads_open`,
etc.) and external APIs (Buffer, Meta Graph, OpenAI image, Venice
text) have no automated probe.

**Recommended probe:** scheduled cron (daily) that hits each
external endpoint with a known-good payload + asserts on the
response shape. Failure → alert in `correlation_alert` category.
Estimated: 1 push (script + cron entry).

### Template escape · gap = no dedicated probe

The v10.0.333 trigger event (XML tag bleed) was caught manually.
The prompt audit at v10.0.444 found no remaining escape paths,
but a regression could land silently.

**Recommended probe:** unit test that fuzzes user-content with
`<{tag}>`-shaped payloads through every templating layer
(prompt builder, chat-history sanitizer, social composer, email
template). Failure → CI block.
Estimated: 1 push (test file + CI hook).

### Race / ordering · gap = no probe

Idempotency keys + transactions prevent the worst-case races, but
a regression in the streaming-finish + verifier-rewrite path
could re-introduce the v10.0.330-era double-reply bug.

**Recommended probe:** integration test that triggers the streaming
+ verifier-rewrite race deliberately (via a synthetic provider
that delays the finish callback) and asserts on the persisted
ChatMessage count.
Estimated: 1-2 pushes (test infrastructure + the test).

## Summary

The v10.0.448 silent-failure-hunter sweep + the v10.0.451 +
v10.0.461 schema audit script + the v10.0.444 audit-script
widening for sort-filter classification all directly fill probe
gaps documented in ADR-0008. This matrix shows the cumulative
coverage state and surfaces the 3 remaining partial categories
as discrete next-targets.

Re-run this matrix when:
- A new failure category emerges (add row · re-audit existing)
- A partial category gets a probe (move to complete)
- A complete category's probe regresses (downgrade to partial)

## References

- ADR-0008 · 8-category glitch taxonomy + 4-phase prevention
- `docs/glitch-taxonomy.md` · canonical taxonomy file
- ADR-0004 · withGuardian (silent-failure prevention)
- ADR-0009 · multi-agent lenses (intent-confusion mitigation)
- `scripts/schema-index-audit.ts` + `schema-timestamp-audit.ts` ·
  schema drift probes
- `scripts/audit-internal-links.ts` + `audit-sort-filter.mjs` ·
  UI surface drift probes
- v10.0.448 · silent-failure breadcrumb sweep
- v10.0.470 (this push) · matrix snapshot
