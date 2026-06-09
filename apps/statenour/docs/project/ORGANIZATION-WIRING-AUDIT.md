# Organization + Wiring Audit — Statenour

> **Date:** 2026-06-09 · **Branch:** `statenour-truth-intelligence-wave` (audit only, no code changed)
> **Method:** 5 read-only explorer agents (file:line evidence) + adversarial cross-check. Audit-first — recommendations are not yet built.
> **Scope:** how organized + usable Statenour is as an operating system now that the truth+intelligence and useful-function (F1–F5) waves exist.

## 0. Headline

The functions are **built and correct** (F1–F5 + memory-evals + runbooks + action-receipt contract; 3155 tests green). The problem is **reachability and visibility, not correctness**:

1. **F1–F5 are unreachable from the UI.** They are API-route + command-registry only — **not** in the chat slash menu, **not** in Cmd+K, **no** `/system` pages or hub cards. The operator can't discover or use them without typing raw HTTP.
2. **The motivation loops are wired but invisible.** Task completion *does* credit XP/stats and lift goals (live, idempotent) — but there is **no feedback at the moment of completion** (no toast, no +XP). You only see the bump by navigating to `/stats` later.
3. **GENERAL anchors are invisible infrastructure.** `/missions` filters them out (`isUserProject`), so auto-classified tasks pile into anchors the operator **cannot see, navigate, or manage** — drifting toward silent inboxes, worse than the old visible Inbox.
4. **Command access is fragmented across 3 systems** that don't share a registry.

> **Data-quality note:** explorer #5 searched the wrong working tree and false-reported F1–F5/evals as "not implemented." That is wrong (the files exist on this branch; tests pass; explorers #1–#4 cite them with file:line). This audit uses the corroborated findings.

## 1. Current organization map

```
NAV / DISCOVERY
├─ Cmd+K command palette ........ 60 actions / 7 groups (nav + system probes)        [components/command-palette.tsx]
├─ Chat slash menu (SLASH_COMMANDS) 28 prompt-templates + nav                          [hooks/use-slash-commands.ts]
└─ F5 command registry (COMMANDS) . 6 service commands  ← in NEITHER menu above        [lib/ai/chat/command-registry.ts]

SURFACES (app/(mastery)/*)
├─ /missions ... execution: user projects + tasks (GENERAL anchors filtered OUT)      [missions/page.tsx, mission-feed.tsx]
├─ /stats ...... mastery: 33-stat character sheet + GoalBoard + body + learn loop     [stats/page.tsx, character-sheet.tsx]
├─ /brain ...... self-model: Memory / Board / Wisdom / Reason tabs                     [brain/page.tsx]
├─ /journal .... capture → type-gated extraction → tasks/insights/XP                   [brain/journal-ingest.ts]
├─ /relationships  people: trust/interaction/leverage                                  [api/people/route.ts]
├─ /system ..... 11 hub cards → 11 ops pages (health, crons, errors, actions, …)       [system/page.tsx, hub-grid.tsx]
└─ /chat ....... Nick: 113 tools + action blocks + slash menu                          [api/ai/chat, lib/ai/tools]

NEW FUNCTIONS (this wave + prior)
├─ F1 session-import   POST /api/system/session-import           (+ /import-session via F5)
├─ F2 change-digest    GET  /api/system/change-digest            (+ /what-changed,/stale via F5)
├─ F3 task-rescue      GET  /api/system/task-rescue              (+ /rescue,/today via F5)
├─ F4 receipt-feed     GET  /api/system/receipt-feed             (+ /receipts via F5)
├─ F5 command-registry POST /api/system/command                  (NOT in chat UI / Cmd+K)
├─ memory-evals        GET  /api/system/memory-evals             (+ inside F2 digest)
├─ runbooks            lib/runbooks + docs/runbooks              (+ inside F2 digest; no UI)
└─ action-receipt      lib/ai/receipts/action-receipt.ts         (contract only — NOT wired to chat finalize)
```

## 2. Wired vs unwired feature matrix

| Function | Status | Reachable from | Evidence |
|---|---|---|---|
| F1 session-import | **api_route_only** (+command) | POST route; `/import-session` via `/api/system/command` | `app/api/system/session-import/route.ts`; `command-registry.ts:120` |
| F2 change-digest | **api_route_only** (+command) | GET route; `/what-changed`,`/stale` | `change-digest/route.ts`; `command-registry.ts:111` |
| F3 task-rescue | **api_route_only** (+command) | GET route; `/rescue`,`/today`. **No UI consumer.** | `task-rescue/route.ts`; "NO UI calls this" (explorer B) |
| F4 receipt-feed | **api_route_only** (+command) | GET route; `/receipts`. Reads EntityAudit+AutonomousAction only. | `receipt-feed/route.ts`; `command-registry.ts:131` |
| F5 command-registry | **command_wired** | POST `/api/system/command`. **NOT** in chat slash menu or Cmd+K; chat-interceptor hook not wired. | `command/route.ts`; `use-slash-commands.ts` has no overlap |
| memory-evals | **api_route_only** | GET route + folded into F2 | `memory-evals/route.ts` |
| runbooks | **library_only** | system prompts + F2 digest; docs only | `lib/runbooks/catalog.ts` (no endpoint/page) |
| action-receipt `toReceipt`/`canClaimDone` | **not_wired** | zero call sites; not in chat finalize | grep: only the definition (explorer D) |
| knowledge `convertToAction` | **not_wired** | zero call sites | grep: only the definition (explorer D) |
| action-result-verifier `detectFailedActionClaims` | **live_wired** | chat finalize (`persist-assistant-turn.ts:464`) | emits `chat_claim_warn` on failed mutations |
| `creditTaskStats` / `liftGoalOnTaskComplete` | **live_wired** | every task-completion path | `task-actions.ts:209/345`, `tasks.ts:839` |
| `isUserProject` / `MissionFeed` | **live_wired** | `/missions` (filters out GENERAL anchors) | `mission-feed.tsx:80` |
| GENERAL anchors (display) | **not_wired (invisible)** | loaded by `listMissions` then filtered out of every UI | `mission-feed.tsx:80`, "ZERO operator-facing code shows anchors" |

## 3. Surface-by-surface clarity

Clarity = is the surface's purpose + the functions it should expose obvious to Nour? (high/med/low)

### /missions — clarity: **medium**
1. **For:** execution — user-chosen projects + their tasks (replaced `/tasks`, Wave AA).
2. **Obvious?** Yes as a project list. **But** the catch-all routing (Inbox + GENERAL anchors) is invisible.
3. **Exposes:** active user missions, tasks-by-mission, unattached tasks, KPI strip, morning brief, top-mission, health strip.
4. **Hidden, should surface:** **GENERAL anchors** (6 domain buckets, filtered out — operator can't see where auto-classified tasks land); **F3 task-rescue** (built, zero UI consumer); classifier confidence/decisions.
5. **Duplicated:** none.
6. **Simplify:** explain *why* a task is "unattached"; give an affordance to move into an anchor/project.
7. **Wire next:** a rescue "needs attention" strip; a way to view/manage GENERAL anchors.

### /stats — clarity: **high (display), low (feedback)**
1. **For:** personal mastery — 33-stat character sheet + GoalBoard + body + learn loop.
2. **Obvious?** Yes — "who you are / where you're going," progress rings + stat chips.
3. **Exposes:** character sheet (level/tier/XP/7d momentum), overall power, top riser, goal ladder, goal→stat chips.
4. **Hidden, should surface:** the **moment of credit** — completing a task earns XP but `/stats` only shows the *aftermath*; there's no "you just earned +5 X" anywhere.
5. **Duplicated:** none.
6. **Simplify:** when creating a goal, say which stat it will level (the inference is silent).
7. **Wire next:** a +XP toast/feed fired from the task-complete path (see Loops).

### /system — clarity: **high**
1. **For:** ops dashboard — health, crons, errors, actions, AI cost, brain, logs.
2. **Obvious?** Yes — status-first layout, 11 hub cards with live severity chips.
3. **Exposes:** Diagnostics, Cron Deck, Errors, Alerts, Coach Channel, Actions, Approvals, AI Cost, Brain, Logs, Calibration.
4. **Hidden, should surface:** **F2 change-digest, F4 receipt-feed, memory-evals, runbooks** — all have data but no card/page.
5. **Duplicated:** F2 change-digest overlaps the existing `deploy-truth` (both report deploy/health) — should link/reuse, not re-derive.
6. **Simplify:** one "What changed + deploy truth" card rather than two deploy reads.
7. **Wire next:** read-only cards for change-digest + memory-evals + receipt-feed.

### chat / Nick — clarity: **high (chat), low (new-function access)**
1. **For:** the AI agent — 113 tools + action blocks.
2. **Obvious?** Chat yes; the new F1–F5 functions are **not reachable as Nick tools** (not in the tool catalog) and **not in the slash menu**.
3. **Exposes:** SDK tools, action blocks, 28 slash templates.
4. **Hidden, should surface:** F5 commands (typing `/today` in chat does NOT hit F5 today); F1–F4 as Nick tools so Nick can run them.
5. **Duplicated:** **3 command systems** (Cmd+K 60 / slash 28 / F5 registry 6) with no shared registry.
6. **Simplify:** one command registry feeding all entry points.
7. **Wire next:** chat-interceptor hook for F5 (registry is built + tested) + add the 6 to the slash menu.

### tasks — clarity: **n/a (folded into /missions)**. Task model is the spine; completion loops are live (§4) but invisible at completion.

### goals — clarity: **medium** (lives on `/stats` as GoalBoard). Progress ring visible; stat-credit invisible; domain→stat inference undisclosed.

### journal — clarity: **medium**
1. **For:** capture → type-gated extraction (tasks/commitments/insights) + XP.
2. **Obvious?** Yes as capture; the downstream extraction is a silent fire-and-forget.
3. **Exposes:** brain-dump → structured extraction, `creditStatXp`, insight→BrainMemory.
4. **Hidden, should surface:** enrichment failures are silently swallowed; `convertToAction` (knowledge→action) is **never called**; journaling "met John" does **not** create a PersonProfile.
5. **Duplicated:** none.
6. **Simplify:** surface an enrichment receipt ("from this entry: +1 task, +2 insights").
7. **Wire next:** journal→action suggestions; journal→person create.

### people (/relationships) — clarity: **medium**
1. **For:** relationship network — trust/interaction/leverage/neglect.
2. **Obvious?** Partially (newer surface).
3. **Exposes:** PersonProfile, sorting, chat-mention interaction bumps, Greene's-Laws by interactionCount.
4. **Hidden, should surface:** people→PEOPLE/INFLUENCE stat credit only fires on **chat mention** — journal/task person-logging doesn't credit; no auto-create from journal.
5. **Duplicated:** none.
6. **Simplify:** one "log interaction" path that credits stats regardless of source.
7. **Wire next:** journal/task → person interaction → stat credit.

### memory (/brain) — clarity: **high**. Unified Memory/Board/Wisdom/Reason tabs. Hidden: memory-evals + runbooks (truth scoreboard) have no surface here.

## 4. The progress loops (motivation engine) — wired vs visible

| Loop | Wired? | Visible? | Evidence |
|---|---|---|---|
| 1. task complete → XP/stat credit | ✅ live | ❌ **invisible** (no toast/feed; must visit /stats) | `creditTaskStats` `task-actions.ts:209/345` → `mastery_xp_event` |
| 2. goal-tagged task → goal stat credit | ✅ live | ⚠️ partial (chips shown, no completion toast) | `effectiveGoalStats` `goal-stats.ts:201` |
| 3. goal currentValue → progress ring | ✅ live | ✅ visible | `liftGoalOnTaskComplete` `tasks.ts:1031` |
| 4. daily streak → XP | ✅ live | ⚠️ streak on card; XP loop invisible in mission context | `task-actions.ts:189/209` |
| 5. mission progress → goal/stat | ⚠️ one-way | ❌ **not visible** (no signal back to mission card) | explorer C LOOP 5 |
| 6. goal edit → stat inference | ✅ live | ⚠️ declared, never explained | `GOAL_DOMAIN_TO_STAT` `goal-stats.ts:45` |
| 7. Nick action → receipt | ⚠️ partial | ⚠️ failures surface; successes/SDK-tools un-receipted | `detectFailedActionClaims` wired; `toReceipt`/`canClaimDone` **not** |
| 8. journal → task/memory/XP | ✅ live | ⚠️ silent (failures swallowed; no receipt) | `enrichJournalEntry` fire-and-forget |
| 9. people → stats | ⚠️ partial | chat-mention only | `conversation-memory.ts:516` |

**The single biggest product gap:** loops 1/2/4 are the motivation engine, and they're **invisible at the moment of action**. Statenour computes the dopamine but never shows it.

## 5. Duplicate / confusing areas

1. **Three command systems, no shared registry** — Cmd+K (60), chat slash (28), F5 COMMANDS (6). F5 is in neither user menu. *Most confusing.*
2. **change-digest (F2) vs deploy-truth** — both report deploy/health; F2 should reuse/link deploy-truth, not re-derive.
3. **receipt-feed (F4) vs existing activity surfaces** — `getGlobalActivity`/`getActorActivity` already drive `/brain/continuity`; F4 reads the same EntityAudit. Risk of a 2nd activity view; prefer extending the existing one.
4. **GENERAL anchors vs legacy Inbox** — both are catch-alls; anchors are invisible, Inbox is visible. Two parallel catch-all concepts.

## 6. Top 10 missing wires (ranked by daily value × low risk)

1. **F5 → chat** (interceptor hook + add the 6 to the slash menu) — makes ALL of F1–F4 reachable where the operator already types. Registry is built+tested.
2. **Task-complete → +XP toast** on `/missions` — makes loops 1/2/4 visible; the motivation win. Small change at the completion response (`runAutoLearn` already rides back).
3. **F3 task-rescue → `/missions` strip** — a "needs attention" card; built, currently zero UI.
4. **GENERAL anchors → visible on `/missions`** — a collapsed "domain buckets" section so anchors aren't silent inboxes.
5. **action-receipt contract → chat finalize** — call `toReceipt` on tool/action results + `canClaimDone` before "done"; completes F4's data + the honesty loop.
6. **F4 receipt-feed → a surface** — extend `/brain/continuity` or a `/system` card (don't build a 2nd activity view).
7. **memory-evals + change-digest → `/system` card** — truth-scoreboard visibility (read-only).
8. **knowledge `convertToAction` → journal/chat** — "turn this into action"; currently dead code.
9. **F1 session-import → a paste box** (chat or `/system`) — usable without HTTP.
10. **journal/task person-logging → PersonProfile + stats** — close the people loop beyond chat mentions.

## 7. Top 5 simplification opportunities

1. **One command registry** behind Cmd+K + chat slash + F5 (collapse 3 systems → 1 source).
2. **One activity/receipt surface** — fold F4 into `/brain/continuity` rather than a new feed.
3. **One deploy-truth read** — F2 links/reuses `deploy-truth` instead of duplicating it.
4. **One XP-feedback primitive** — a shared `+XP` toast fired from the task-complete path, reused on `/missions` + `/stats`.
5. **GENERAL anchors: decide one role** — either an operator-visible domain bucket OR a pure routing internal; not an invisible third inbox.

## 8. Recommended build sequence (next wave — not yet built)

Ordered for value-per-risk; each is additive, no migration, no route rewrite:

1. **Wire F5 into chat** (interceptor hook, single seam) + add the 6 commands to the slash menu. → unlocks F1–F4 for daily use. *(Coordinate with the concurrent session that's in the chat/classifier path.)*
2. **Task-complete +XP toast** (loops 1/2/4 visible). Highest motivation ROI.
3. **`/missions`: rescue strip + GENERAL-anchor section.** Makes /missions a real operating surface and answers the anchor question.
4. **action-receipt contract → chat finalize** (then F4 feed is complete + honest).
5. **`/system` read-only cards:** change-digest + memory-evals + receipt-feed (fold receipts into /brain/continuity if cleaner).
6. **journal → action + journal/task → person/stats** (close the capture + people loops).

## 9. Push readiness (the function wave)

**Safe to push now** — additive, branch-green (typecheck 0 · 225 files/3155 tests · build green · review-fixed), no migrations, no prod-data writes, no chat-route changes. Pushing ships **working-but-hidden** capability (no regression, no UI exposure yet).

**Recommendation:** the wave is push-safe, but its *value* is locked until the wiring above lands — especially **#1 (F5→chat)** and **#2 (XP toast)**. Two reasonable paths: (a) push now (banked, zero risk) and wire next; or (b) bundle #1+#2 onto this branch first so the push delivers usable value. Either is fine; the audit's verdict is that **reachability, not correctness, is what's missing.**
