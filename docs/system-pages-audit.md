# `/system/*` page audit · Phase C consolidation plan

> **Status**: Audit complete · operator action required for actual merges
> **Generated**: 2026-05-18 · post-Wave-200
> **Why**: operator surfaced "id like more organized" during brainstorm
> · 35 `/system/*` pages have grown organically · this maps them and
> recommends consolidation paths

---

## Why this is documentation-only

35 `/system/*` pages were each built for a reason. Bulldozing without
operator confirmation risks losing diagnostic surfaces they actually
use. This audit identifies:
- **Safe consolidations** (clear dupes · operator confirms · I rip)
- **Judgment merges** (related but different purposes · operator
  decides what to keep)
- **Keep-as-is** (load-bearing diagnostic surfaces)

Process: operator reads this · marks each row [merge|keep|kill] · I
execute the actions in a follow-up commit.

---

## Inventory · 35 pages grouped by domain

### CRON OBSERVABILITY (4 pages · candidate for merge)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/crons` | ? | Cron registry · list of all jobs · folded vs active | KEEP (canonical list) |
| `/system/cron-diagnostics` | ? | Per-cron drift + silent-failure detection | MERGE INTO `/system/crons` (tab) |
| `/system/cron-runs` | ? | Recent runs log · history | MERGE INTO `/system/crons` (tab) |
| `/system/logs?view=...&filter=cron` | (existing) | Cron-filtered log view | KEEP (already a view of logs) |

**Recommendation:** consolidate to `/system/crons` with 3 internal
tabs: Registry · Diagnostics · Recent runs. Drops 2 standalone pages.

### COST OBSERVABILITY (2 pages · candidate for merge)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/ai-cost` | ? | Per-provider AI spend (Venice/Ollama/Anthropic) | KEEP (specific AI lens) |
| `/system/costs` | ? | Generic cost dashboard | MERGE INTO `/system/ai-cost` OR keep if covers non-AI (Railway/Neon/etc.) |

**Recommendation:** check if `/system/costs` covers infrastructure
beyond AI. If yes, keep both · if no, merge.

### HEALTH OBSERVABILITY (5 pages · audit for overlap)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/health` | 566 | OS health dashboard (DB · API · cron · alert rollup) | KEEP (canonical) |
| `/system/chat-health` | ? | Chat-pipeline-specific health | KEEP (specialized) |
| `/system/brain-bus` | ? | Brain bus heartbeat · LISTEN/NOTIFY | KEEP (specialized) |
| `/system/status` | ? (dir only?) | Possible alias · investigate | INVESTIGATE |
| `/system/deployment-truth` | ? | Which commit is actually live | KEEP (auditable truth surface) |

**Recommendation:** verify `/system/status` exists and isn't an empty
dir · all others have specific purposes worth keeping.

### AI / EVAL OBSERVABILITY (5 pages · cluster-worthy)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/agent-traces` | ? | Per-turn AgentTrace records | KEEP (debugging) |
| `/system/eval-results` | ? | Judge-eval scores trend | KEEP (quality lens) |
| `/system/prompt` | ? | System prompt inspector | KEEP (prompt audit) |
| `/system/quality` | ? | Quality drift scoring | KEEP (operator-facing) |
| `/system/policies` | ? | Auto-correction policies | KEEP (config) |

**Recommendation:** keep all 5 · already cohesive cluster. Consider
adding a `/system/ai` index page that links to all 5 (no merge).

### LOGS / HISTORY (3 pages · already coherent)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/logs` | ? | Live ErrorLog/CronJobLog/SystemMetric stream | KEEP (the canonical log surface) |
| `/system/history` | ? | Historical snapshots · trend view | KEEP (complement to logs) |
| `/system/schema-history` | ? | DB schema change audit | KEEP (specialized) |

### OPERATIONAL (10 pages · review individually)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/actions` | ? | AutonomousAction log | KEEP |
| `/system/alerts` | ? | Alert dashboard | KEEP (operator-actioned) |
| `/system/approvals` | ? | Pending operator approvals | KEEP (operator-actioned) |
| `/system/cockpit` | 159 | Unified operator cockpit (Wave 65) | KEEP (canonical cockpit) |
| `/system/coverage` | ? | Test coverage report | KEEP if used · KILL if vestigial |
| `/system/devices` | ? | Device tracking (per memory: stale subsystem) | INVESTIGATE · likely KILL |
| `/system/features` | ? | Feature flag panel | KEEP (config) |
| `/system/ghost-nour` | ? | Ghost Nour identity surface | KEEP (brain feature) |
| `/system/power` | ? | Power-mode surface | INVESTIGATE |
| `/system/repos` | ? | Repo registry (statenour + nickstire + worker) | KEEP |

### SPECIALIZED (6 pages · domain-specific)

| Page | LOC | Purpose | Recommendation |
|---|---|---|---|
| `/system/lens-stats` | ? | Lens framework firing stats | KEEP |
| `/system/skills` | ? | Skill registry surface | KEEP (1,423-skill recall layer) |
| `/system/tire-stock-requests` | ? | Tire stock requests (likely retired · shop-side now) | LIKELY KILL · separation pass moved shop to nickstire |
| `/system/tools` | ? | Tool catalog inspector | KEEP |
| `/system/vapi-calls` | ? | VAPI call log | KEEP |
| `/system/performance` | ? | Perf dashboard | KEEP |

---

## Recommended quick wins (operator confirm · I execute)

1. **`/system/cron-diagnostics` + `/system/cron-runs` → tabs inside `/system/crons`** — saves 2 surfaces, no operator value lost
2. **`/system/tire-stock-requests` KILL** — shop operations moved to nickstire.org/admin (per `feedback_business_separation.md`)
3. **`/system/devices` INVESTIGATE then KILL** — per memory, device tracking subsystem is stale
4. **`/system/coverage` INVESTIGATE** — if vestigial, kill
5. **`/system/power` INVESTIGATE** — purpose unclear

Net: 3-5 page deletions · -700 to -1500 LOC · without losing capability.

---

## Operator action items

1. Mark each row in this audit `[merge|keep|kill|investigate]`
2. Push back the marked-up version OR tell me "execute recommendations
   as-is"
3. I ship the actual deletions/merges in a follow-up commit (Phase C.2)
4. Each kill goes to git history · recoverable

---

## What I'm NOT doing today

- **Not deleting any /system/* page** without operator confirmation
- **Not merging anything** that hasn't been explicitly mapped above
- **Not touching /system/health** (566 LOC · operator-essential)

Phase C as designed = audit + plan. Execution waits for operator's
go-signal on each row.

---

## See also

- `docs/adr/0010-goals-page-merge.md` · Phase A.1 (analogous merge)
- `docs/adr/0011-meta-scoreboard.md` · Phase A.2
- `docs/WAVE-200-PLAN.md` · Phase C parked entry
- `apps/statenour/.remember/now.md` · operator's running notes
