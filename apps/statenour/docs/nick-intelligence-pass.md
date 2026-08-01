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
| `NICK_EVENT_TRIGGERS` | Inngest event-fn reacts to brain-bus drift in seconds | `true` | ON |
| `NICK_DEEP_REASONING` | Hard turns → reasoning engine (decompose→plan→critique→refine) + live-data snapshot | `true` | ON |
| `NICK_VERIFIED_REGEN` | Critic-gated best-of-2 regen before shipping (non-streaming) | `true` | OFF |
| `NICK_CONFIDENCE_TIER` | Auto-execute the 4 safe internal actions w/o /qa (paranoid-gated) | `true` | OFF |

`NICK_EVENT_TRIGGERS` is fully live: `INNGEST_EVENT_KEY` IS set on Railway (verified 2026-06-03,
alongside `INNGEST_SIGNING_KEY`), so brain-bus drift events deliver in real time — no further
action needed.

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
- `OLLAMA_VISION_MODEL` — routes `taskType:"vision"` so image turns stay multimodal while chat
  uses the stronger text model. **Leave it UNSET** unless pinning a verified-live model; unset
  means the registry default in `config/ai-providers.ts` (`gemma4:31b`) applies.
  ⚠️ 2026-08-01 · this line used to read `qwen3-vl:235b-instruct`. That model was RETIRED on
  Ollama Cloud 2026-06-16 (HTTP 410) — pinning it silently kills every image turn.
- Revert model: `railway variables --set OLLAMA_MODEL=<verified-live-model> --service statenour-web`.
  ⚠️ This line used to name `qwen3-vl:235b-instruct`; following it would have pinned the PROD
  **chat** lane to a retired model. Verify a model answers on the key before setting it.

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

## 8. Follow-ups (status as of 2026-06-03)

- ~~Set `INNGEST_EVENT_KEY`~~ — **DONE / already set.** Verified present + non-empty on Railway;
  `NICK_EVENT_TRIGGERS` is fully live.
- ~~Half-installed `protect-mcp` hooks~~ — **N/A.** Re-checked: no `~/.claude/keys/` dir exists and
  zero `protect-mcp` refs in the global `settings.json`. Nothing was installed; nothing to roll back.
- Optional: shared `PageSkeleton` loading slot for full loading-state uniformity (still open, polish).

## 9. Code-health pass — chat pipeline simplification (2026-06-03)

A read-only code-explorer audit of the chat pipeline (`app/api/ai/chat/route.ts`,
`lib/services/chat/persist-assistant-turn.ts`, `lib/ai/provider.ts`, `lib/ai/reasoning/engine.ts`,
`lib/ai/chat/*`) produced a 12-item simplification backlog. **5 SAFE, behavior-preserving wins
shipped** (tsc 0 · 919 ai tests green):

- **route.ts** — python-execute regex deduped (reuse the hoisted `__pythonExecuteIntent` instead of
  a second copy of the 130-char literal); `genBase` hoisted once above the regen/self-consistency
  branches (was two identical literals).
- **provider.ts** — Venice + Ollama quota circuit-breakers (byte-for-byte parallel) collapsed into a
  single `makeQuotaBreaker(provider, cooldownMs)` factory; the divergent `isXAvailable()` predicates
  stay separate. Exported names preserved.
- **reasoning/engine.ts** — the 6 repeated `await import("traced-aichat") + makeTracedAiChat(...)`
  blocks replaced by one shared module-scope `tracedAiChat` (engine is server-only → static import safe).

**Verify-don't-trust catch:** the audit flagged the `preferLargeContext` sort in `provider.ts` as a
dead no-op — **NOT applied.** `PROVIDERS` leads with the Venice+Ollama tag-team; if Venice is index 0
that sort genuinely reorders Ollama to the front and is load-bearing. Left untouched pending proof.

**Round 2 — the deferred §9 backlog SHIPPED (5 SAFE refactors, tsc 0 · 927 ai tests green):**
extracted the GSC-prefetch (→ `app/api/ai/chat/gsc-prefetch.ts`, all 🚨 templates byte-for-byte) and
customer-shape-hint (→ `app/api/ai/chat/customer-shape-hint.ts`, regex moved with it) out of `route.ts`;
relocated `looksLikeBrainDump` → `lib/ai/chat/brain-dump-detector.ts`; dropped the derived
`isLightweight`/`isHeavy` from `DeferredBackgroundCtx` (now computed inside `runDeferredBackgroundWork`
with the identical thresholds); extracted a `buildMessageParts` helper in persist-assistant-turn
(parameterized `alwaysIncludeText` — verify-don't-trust caught that the rewrite-patch site pushes text
unconditionally vs the guarded initial-persist site). **Still deferred — the 1 RISKY item:** collapse
the `standard`-tier critique branch via `tier-config` (needs tier-config value verification first).

**NOT flagged (verified divergent-by-design, leave alone):** action-claim-detector vs
action-intent-detector (output- vs input-side); the `buildOnFinish` file (cohesive sequential
pipeline, not a god-file to shatter); the 4 flag-gated alt-path branches (different internals,
`winner` is already the right boundary).

## 10. Chat ↔ rest-of-statenour connectivity audit (2026-06-03)

A read-only audit traced every seam between the chat pipeline and the rest of the app (tools →
nickstire bridge, brain recall, mastery/XP, business-intel, persist-back). **2 real wiring bugs
fixed** (both made Nick give wrong/empty answers):

- **`getProjections` 30-day revenue was actually 1-day** (`lib/ai/tools/goals.ts`) — the tool sent
  the `revenue_range` bridge query a `{ since }` filter, but the nickstire handler reads `{ from, to }`
  (both default to *today*). So Nick's "30-day revenue × 12" annual projection was really today × 12.
  Fixed to send the real 30-day `{ from, to }` span (matches the tool's own `revenue_30d` label).
- **Bridge env-key drift** (`lib/services/bridge.ts`) — `fetchShopSnapshot` + `fetchShopHealth`
  resolved the key as `BRIDGE_API_KEY` only, while the canonical `queryNick` client uses
  `STATENOUR_SYNC_KEY || BRIDGE_API_KEY` (the live Railway key). Snapshot silently fell through to the
  slow 4-query batch; health returned `null` outright. Unified both onto a shared `resolveBridgeConfig()`
  matching the canonical client.

**Deferred (low-severity / cross-app-unverifiable / graceful-degrade — documented, not rushed):**
deep-reasoning `getDashboardSummary` snapshot may cite a cron-cached review count (label it with a
timestamp); `marketing_attribution` depends on a hand-applied nickstire `leads.invoiceId` migration
(soft-fails gracefully if absent); the `chat_claim_warn` rows persist but the `/api/ai/chat/claim-warnings`
reader route was never built (hedge banner on stored text already works — display gap only); the
`leads_urgent` fallback unpack in `bridge.ts` guesses `count` (needs the nickstire-side shape confirmed).

**Verified HEALTHY (no action):** all 8 `brain-context.ts` parallel module imports; `compareLiveRevenue`
two-call collision fix; `queryNick` env priority; `buildConcernsContextBlock`/`buildTaskContextBlock`
exports; the chat's graceful-degrade `.catch(() => null)` recall lane (works as designed). The chat has
no real-time mastery/XP write — that's cron-driven by design, not a broken wire.
