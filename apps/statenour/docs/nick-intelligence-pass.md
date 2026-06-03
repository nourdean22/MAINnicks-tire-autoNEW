# Nick Intelligence Pass + Every-Page Audit — Reference & Operating Guide

_Last updated: 2026-06-03 · commit range `0f0af8a9` → `1e2329bd` on `main`_

This documents the chat-truth fix, the next-level-intelligence pass, the glm-5.1 model
upgrade, the proactive-staleness sweep, and the every-page surface audit/cleanup. It is the
operator + developer reference for the `NICK_*` feature flags and how to run them safely.

---

## 1. Overview

Three threads shipped together:

1. **Chat-truth + staleness correctness** — Nick stopped flagging its own citations as
   fabrication, stopped surfacing stale data as present-tense, and stopped mislabeling metrics.
2. **Next-level intelligence (15 features)** — reasoning / memory / autonomy upgrades, every
   one behind a `NICK_*` env flag, **default-OFF**, wired to a real consumer.
3. **Every-page audit + cleanup** — all 41 pages audited; broken iOS-PWA controls, dead nav,
   and inconsistent headers fixed; 14 pages migrated to the canonical header.

**Governing rule:** every new capability ships behind an experimental env flag defaulted OFF;
prod behavior is byte-for-byte unchanged until the operator flips the flag on Railway.

---

## 2. Feature-flag control plane (`lib/feature-flags.ts`)

Flags are env vars on Railway service `statenour-web`, read via `getFlag("X")?.isOn`, surfaced
on `/system/migrations`. Set: `railway variables --service statenour-web --set "X=true"`.
Remove (revert): `railway variables delete X --service statenour-web`.

| Flag | What it does | On-value | Live? |
|---|---|---|---|
| `NICK_IMPORTANCE_RECALL` | Generative-Agents R+R+I importance axis in brain recall ranking | `true` | ON |
| `NICK_COVE` | Chain-of-Verification on factual answers (isolated self-check, post-stream) | `true` | ON |
| `NICK_CONTEXTUAL_RETRIEVAL` | Per-chunk LLM context header before embedding (ingest path) | `true` | ON |
| `NICK_AUTONOMY` | Proactive engine (~22 rules) + nick-action queue — **fail-closed, /qa-gated** | `true` | ON |
| `NICK_ANTICIPATORY_RECALL` | Anticipatory memory prefetch | `true` | ON |
| `NICK_REFLECTION_TREES` | Higher-order reflection synthesis (rides reflect-categories cron) | `true` | ON |
| `NICK_CONTRADICTION_CLEANUP` | Soft-deletes the losing side of resolved contradictions | `true` | ON |
| `NICK_EPISODIC_SPLIT` | Reserves recall slots for episodic vs semantic memory | `true` | ON |
| `NICK_OUTCOME_LEARNING` | Learns from proposal accept/reject history | `true` | ON |
| `NICK_SELF_CONSISTENCY` | N-sample vote on numeric/high-stakes answers | `true` | ON |
| `NICK_MULTI_AGENT_AUTO` | Auto-decompose complex turns into sub-agents | `true` | ON |
| `NICK_EVENT_TRIGGERS` | Inngest event-fn reacts to brain-bus drift in seconds | `true` | ON* |
| `NICK_DEEP_REASONING` | Hard turns → reasoning engine (decompose→plan→critique→refine) + live-data snapshot | `true` | ON |
| `NICK_VERIFIED_REGEN` | Critic-gated best-of-2 regen before shipping (non-streaming) | `true` | OFF |
| `NICK_CONFIDENCE_TIER` | Auto-execute the 4 safe internal actions w/o /qa (paranoid-gated) | `true` | OFF |

\* `NICK_EVENT_TRIGGERS` is ON but needs `INNGEST_EVENT_KEY` set on Railway to actually deliver
events (safe no-op until then).

**Held OFF by operator choice / tradeoff:** `NICK_VERIFIED_REGEN` (trades token streaming for a
slower full-generate), `NICK_CONFIDENCE_TIER` (removes the human-approval gate).

---

## 3. Safety model (autonomy)

`lib/brain/autonomous-engine.ts` is **FAIL-CLOSED**: a rule fires unattended ONLY if an explicit
`auto` `AutomationPolicy` row exists for it. No policy → it defers to `/system/approvals` (the
`/qa` Telegram queue) — **nothing auto-sends**. The nick-action proposal/execute routes also
hard-skip when `NICK_AUTONOMY` is off. `NICK_CONFIDENCE_TIER` (auto-execute) is allow-listed to
4 internal, reversible, non-messaging actions (archive_mission / nudge_task / reassign_task /
commit_journal) and only after ≥8 approvals at ≥80% acceptance — and is currently OFF.

---

## 4. Models & provider chain (`lib/ai/provider.ts`)

- Provider order: `[ollama, venice, openai, anthropic]` with per-request failover + a
  recently-failed skip window. **Do NOT set `AI_PROVIDER`** — it hard-pins one provider and
  DISABLES failover (this was the root cause of a prod chat stall; it was removed).
- `OLLAMA_MODEL=glm-5.1` — chat model (operator-chosen: strongest + least-restricted GLM;
  tool-calling verified live).
- `OLLAMA_VISION_MODEL=qwen3-vl:235b-instruct` — `createOllamaModel` routes `taskType:"vision"`
  here so image turns stay multimodal while chat uses the stronger text model.
- Revert model: `railway variables --set OLLAMA_MODEL=qwen3-vl:235b-instruct --service statenour-web`.

---

## 5. The recurring bug class: "stale data shown as present-tense"

Every proactive surface that queried old records with no recency gate (or mislabeled a value)
was a deficit. The fix patterns, reused across the codebase:

- **Recency floor** on the query (`created_at >= NOW() - INTERVAL '30 days'`, `date >= 14d`).
- **Age ceiling** in the surfacing loop (`if (daysOverdue > 90) continue;`).
- **Entity stopword** (don't treat generic nouns / the business name / identity-axis labels as
  lead/person entities — e.g. "Shop", "Velocity").
- **Honest relabel** (the displayed label must name the actual metric — e.g. "beliefs revised"
  was really `contradictionsResolved`; "brain maturity" chip was really the identity-axes avg).
- **Freshness honesty** (a snapshot/chip tags its age when stale instead of asserting "live").

Fixed instances: memory-of-the-day nick-advice leak, the 809-day commitment nag, the
`financial 2/100 "today"` chip, blind-spot drift/stale-loop ceilings, identity-snapshot staleness
tag, body weight-freshness, MIND/journal/brain mislabels.

---

## 6. Page audit + uniformity

- **iOS-PWA dialog sweep:** 11 controls used `window.confirm/prompt/alert` (silently dead in the
  operator's standalone PWA) → migrated to the in-DOM `confirm-dialog.tsx` primitives.
- **Dead-nav prune:** `/system` hub-grid 33→12 cards (removed redirect-only/404/colliding cards;
  restored Calibration + Reviews); removed dead cross-links; deleted orphan `system/status/`.
- **Header uniformity:** 14 pages migrated to the canonical `StandardPage`/`PageHeader`
  (`description` prop widened to `ReactNode` to support live-metric subtitles). `decisions`/
  `journal`/`missions` deliberately left (richer primitives, not deficits).
- **Other fixes:** broken drafts→schedule loop, `content/history` `undefined/undefined`,
  retired `/habits` sign-in redirect, outreach neutral default segment.

---

## 7. Verify & operate

- **Verify gates (from `apps/statenour/`):** `pnpm typecheck` (0) · `npx vitest run tests/ai
  tests/brain --pool=forks --poolOptions.forks.singleFork=true` · `pnpm build` (the push gate).
- **Runtime-verify a flag:** flip it on Railway, drive a chat on bdnick.info, observe; rollback =
  `railway variables delete <FLAG>`.
- **Recommended enable order:** `NICK_COVE` first (trust), then the others; flip `NICK_AUTONOMY`
  and read the morning `/qa` digest before approving anything.

---

## 8. Follow-ups (non-deficit)

- Set `INNGEST_EVENT_KEY` to activate `NICK_EVENT_TRIGGERS` real-time delivery.
- Optional: shared `PageSkeleton` loading slot for full loading-state uniformity.
- Half-installed `protect-mcp` hooks in global `~/.claude/settings.json` (separate task).
