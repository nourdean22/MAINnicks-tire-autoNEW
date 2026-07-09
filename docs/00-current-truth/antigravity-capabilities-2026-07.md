# Antigravity Capability Arc — Operator Runbook (2026-07-09)

Single source of truth for the 26-packet capability wave shipped 2026-07-09 (Waves 0–3, PRs #649/#650/#651/#652/#654 — all merged and deployed). The thesis of the arc: statenour was full of finished machinery that was never wired in; ~70% of this work is wiring and truth-fixes, not new invention.

Runtime claims marked **(designed-to)** are deployed but not yet observed end-to-end in prod — each lists its observation probe.

---

## 📱 Telegram command surface (what changed)

| Command | What it does now | Notes |
|---|---|---|
| `/remind in 2h \| at 3pm \| tomorrow 9am [text]` | Creates a WAITING task with `snoozedUntil`; the hourly proactive-push cron pings you when due **(designed-to — probe: first real reminder)** | Deterministic ET/DST-correct parser, never an LLM guess. Hourly granularity is the v1 contract. |
| `/ask [question]` | Real tool loop: reads your calendar, searches brain memory, can propose events and capture tasks | Bounded: 4 small tools, 4 steps, 25s. Heavy work still belongs in chat. |
| `/qa 1 3 \| all \| none` | Approved moves **execute within seconds** via an Inngest event; digest lands in Telegram ~1 min **(designed-to — probe: next real /qa tap)** | The 9am cron remains as backstop. Double-execution impossible (atomic per-row claim). |
| `/board [strategic\|invest\|product\|operator\|full\|team] [q]` | `team` is new — convenes thought-partner, research-analyst, strategist, tactician, business-consultant on one question | Use `team` for working decisions, `strategic` for identity-grade ones. |
| `/spar`, `/team`, `/research`, `/draft` | Shipped earlier in the arc (Waves 1–2) — dialectic sparring, team fan-out, async cited research (~2 min delivery), voice-matched ghostwriting into the approval queue | |

Intentionally **not** built: a 30-min Gmail urgent-nudge sweep — operator decision 2026-05-30 ("one a day on google") stands; only the cron manifest's false 30-min claim was fixed.

## 🧭 Specialist routing — shadow mode (NEW flag state)

`ENABLE_SPECIALIST_ROUTING` on `statenour-web` now supports three values:

- unset / anything else — routing fully off (default for years)
- **`shadow` — CURRENT PROD STATE (set 2026-07-09):** classifier runs on live chat, records what *would* have routed as `SystemMetric metric='specialist.route'`, never dispatches
- `true` — specialists actually take over matching turns

**Operator loop:** after a few days of chat, inspect `specialist.route` rows (value = confidence, tags = route/reason). Good routes at sane confidence → consider `true`. Garbage → leave in shadow or unset, zero user-facing cost.

Safety invariants (do not reorder): the specialist block runs **after** the deterministic interceptors (image/decision/brain-dump always win) and **behind the daily budget gate**.

## 🕐 nickstire HR time-clock (durable)

- Migration **0077 `time_clock_entries`** applied to prod TiDB 2026-07-09 (verified: 5 columns, FK → technicians `ON DELETE RESTRICT`). One row per shift; clock-out no longer erases history.
- Dispatch → Technicians tab shows an **"Hours · last 7 days"** table once shifts accrue **(designed-to — probe: first clock-in writes a row)**. Open shifts count to now, capped at 12h; `+` marks an open shift.
- Ledger writes are fail-soft: a ledger error never blocks clock in/out.
- **Applicant guard (live-bug fix):** careers-form leads (`source='careers'`) are excluded from the stale-lead follow-up SMS. Applicants are HR pipeline, never sales outreach.

## 🔁 Self-improving loops now closed

- **Persona scorer → selection:** sub-agent runs record *derived* confidence; a persona scoring `tune` over ≥10 runs is demoted to the generic prompt (never swapped for a different persona) and logged as `SystemMetric persona.swap`.
- **Publish → performance:** Mondays 12:00 UTC, real Meta insights land on each published post (`sourceMetadata.performance`) and the top-3 become BrainMemory `content_winners` → the ghostwriter's RECENT WINNERS block. Requires `META_PAGE_ACCESS_TOKEN`; absent data stays absent (no fabrication).
- **Deep research:** now reads the top cited pages in full (≤3, one per host, fenced) + one gap-check round; reports <7 days old are reused instead of re-spent.
- **Reality-grounding rule (Wave 0, arc-wide):** unavailable connector data is EMPTY, never mocked — applies to every intelligence connector, competitor watch, and content metrics.

## 🛠️ Maintenance commands (statenour)

```bash
# Skill registry — NEVER bare-rebuild (440+ registry entries live only on other machines)
pnpm tsx scripts/build-skill-registry.ts --merge --dry-run   # preview diff
pnpm tsx scripts/build-skill-registry.ts --merge             # safe merge

# Registry ↔ prod embedding drift (read-only; exit 2 on drift)
railway run --service statenour-web -- pnpm tsx scripts/audit-skill-embeddings.ts

# Embed newly-registered skills (idempotent, prod-writing — deliberate step)
railway run --service statenour-web -- pnpm tsx scripts/embed-skills.ts
```

Guardian note: approval dedupe now has a **24h window** — identical requests a day apart are new intents; old rejections no longer block forever.

## 📌 Open items (as of 2026-07-09)

- `vars.json` committed-secrets rotation — operator-deferred (chip task_2f52f22c).
- Cron-manifest schedule sweep — running in a separate chip session.
- Ghostwriter critic permissiveness — corporate slop can score 61+ with zero offender hits; tuning candidate.
- Flip `ENABLE_SPECIALIST_ROUTING` to `true` only after the shadow metrics say so.

*Full packet-by-packet history: PRs #649, #650, #651, #652, #654. Deep design notes live in the PR bodies.*
