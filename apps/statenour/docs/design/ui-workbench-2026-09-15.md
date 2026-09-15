# StateNour UI Workbench -- gate verdict, corrected plan, object model, ownership map

**Date:** 2026-09-15 · **Base:** `dd61b8a1d` (= `main` = production `/api/version` at 16:12Z) ·
**Branch:** `claude/statenour-ui-architecture-intmaf` · **Skill:** `plan-gate` (order of checks 0-5 run in full).

**Input:** a pasted 38-section plan ("NOUR Spatial Workbench": universal Peek + Inspector, URL-addressable
inspector, Intent Resolver, Workset, Selection, page archetypes, NourUI, Reality Mode, Time Travel, ...).
This document is the gate's output and the spec for what was built on this branch. Every claim below
carries a `file:line` receipt read on this SHA; a claim with no receipt is marked as such.

**Epistemic legend:** CONFIRMED = matches the code · PARTIAL = true with a material caveat · REFUTED =
the code contradicts it · NATIVE / PATTERN / WATCH / REJECT = `docs/UPSTREAMS.md` vocabulary.

---

## 0. Verdict in one paragraph

About 60% of the plan describes things that already exist (correctly, and in more detail than it credits);
about 10% is refuted or stale; about 30% is genuinely new. The new 30% is the valuable part, and it is
ONE thing, not fifteen: **StateNour has no shared object grammar above `StandardPage`.** Every sophisticated
page invented its own detail panel (20 bespoke overlays, 6 of them entity-detail drawers), entity focus
travels by three different channels (`?tab=`, `?focus=`, `#hash`), and nothing lets the operator select
an object and act on it the same way everywhere. The plan's own build order would have failed this repo's
CI: a "Wave 1 substrate with no page changes" ships unconsumed exports and unreachable components, which
`tests/repo/ui-mount-graph.test.ts` and the knip orphan gate both reject. The corrected order is
**vertical slices**: each primitive lands with its first real consumer and a test that failed first.
This branch ships the first three slices (memory, task, person) through one inspector, plus the substrate
they run on. Reality Mode moves from the plan's "Wave 7 weird intelligence" to the first slice, because
the evidence vocabulary it needs already exists and is the product's actual moat.

---

## 1. Gate results, claim by claim

### 1.1 Substrate claims

| # | Plan claim | Verdict | Receipt |
|---|---|---|---|
| S1 | `StandardPage` standardises title/width/rhythm/loading/actions/parent nav, and says >5 sections is a smell | CONFIRMED | `components/layout/standard-page.tsx:33-35`, `:106-109`, props `:76-129`. Adoption is 16 import sites vs 19 files still on bare `PageHeader` -- canonical by doc, not by fact. |
| S2 | `PageContextBridge` "tracks the entity the operator is viewing globally" | PARTIAL | `components/chat/page-context-bridge.tsx:62-88` recognises exactly four shapes (`/decisions/<id>`, `#bd-`, `#pin-`, `#task-row-`). Three of its seven fields have no producer. Consumers: the layout and `features/chat-v2/hooks/use-chat-stream.ts:76-77`. It reads pathname + hash, never search params. **Adjacent rot:** chat tool links emit `/missions#task-row-<id>` (`components/chat/tool-result-registry.tsx:69,85,101,123`) while the live row id is `task-<id>` (`components/missions/mission-task-row.tsx:199`) -- the deep link scrolls nowhere and the bridge never sees the task. |
| S3 | Command palette has NAV nav, hybrid Brain search, recents, diagnostics, system actions, relationship logging, deep links, async results | CONFIRMED (8/8) | `components/command-palette.tsx:245-257` (NAV), `:479-531` (search-hybrid, 3+ chars, 250ms), `:86-87,614-634` (recents, cap 8), `:267-269`, `:280-291`, `:568-571`, `:538-551`, `:212-237`. Groups are six, not nine. Memory hits currently route to `/brain?tab=wisdom&focus=<memoryId>` (`:541-542`) -- a memory id sent to the wisdom tab's key-based focus. |
| S4 | Bottom bar measures chrome height, safe areas, 52px+ targets, 9px labels; MORE sheet has 8-10px labels | CONFIRMED | `components/layout/bottom-tab-bar.tsx:50-68` (ResizeObserver -> `--bottom-chrome-h`), `:93`, `:110,129` (`min-h-[52px]`; its docstring `:9` still says 44px), `:120,132` (`text-[9px]`). `more-sheet.tsx` has 8px at `:194,224,243,298`. The program's open item §5.1 ("raise the floor 9->11, 10->12") already owns this; the plan's item 7 is not new. |
| S5 | One NAV registry feeds bar, MORE sheet and palette | CONFIRMED | `components/layout/nav-items.ts:18-33,54-103`; consumers `bottom-tab-bar.tsx:20,101`, `more-sheet.tsx`, `command-palette.tsx:50,247`. |
| S6 | Design doctrine: void black, gold, glass, Barlow Condensed + Geist, no purple SaaS | CONFIRMED | `docs/DESIGN.md:3,8-10,104-106`; `app/styles/tokens.css:12,43,91,96`. Only three rules are gate-checked (`DESIGN.md:18-28`). |
| S7 | "One inspector system, not 14 custom drawers" | REFUTED (undercount) | 20 bespoke overlays, each with its own backdrop/z-index/escape/safe-area; 6 are entity-detail drawers (`relationships/person-edit-drawer.tsx:252`, `missions/task-edit-sheet.tsx:275`, `missions/mission-edit-drawer.tsx:171`, `chat/memory-inspector-sidebar.tsx:69`, `home/brain-node-detail-panel.tsx:161`, `features/chat-v2/components/operator-conversation-drawer.tsx:63`) plus the inline `DetailPanel` at `app/(mastery)/people/page.tsx:746`. `chat-media-focus-panel.tsx:14` says it copied the sidebar chrome "verbatim". No reusable Drawer/Sheet/Inspector primitive exists; only `components/ui/dialog.tsx` (Base UI Dialog, 6 consumers). |
| S8 | Selection as a primitive | REFUTED (nothing live) | The only multi-select + bulk bar is `components/actions/loop-stream.tsx:329-341,1400-1407`, PARKED with zero importers (`tests/repo/ui-mount-graph.test.ts:48`). |
| S9 | `?inspect=` URL-addressable inspector | REFUTED (nothing exists), and the pattern to copy does | Zero `?inspect=`. Entity focus today: `?tab=` (`page-tabs.tsx:10,43-59`), `?focus=` (wisdom key, `wisdom-tab.tsx:192`), `?resolve=` (`memory-tab.tsx:66`), and hashes. `page-tabs.tsx` is the URL-sync pattern to reuse. |
| S10 | Workset / working set | REFUTED (does not exist); Pins are something else | Zero hits. `/pins` is AI-prompt context governance and already knows staleness (`pins/page.tsx:65-71`), token cost (`:292`) and top-5 injection (`lib/pins/injected.ts:14-24`) -- the plan's §Pins "Context budget" is largely NATIVE. |
| S11 | TanStack Virtual "installed, use now" | PARTIAL | Declared (`package.json:110`, resolved 3.13.24) and imported NOWHERE; `hooks/chat/use-lazy-render-messages.ts:11-13` records why chat rejected it. A dead dependency until a named list adopts it. |
| S12 | Recharts for simple charts; add Observable Plot | PARTIAL | `recharts` has one import site (`components/stats/body-section.tsx:38`, lazy). No Plot, d3, sigma, react-flow. Charts are hand SVG (`components/chat/inline-chart.tsx`, `ui/sparkline.tsx`). |
| S13 | Base UI `^1.3.0`, check resolved; 1.8 available | CONFIRMED | Resolved 1.4.1 (lockfile); 1.8.0 published 2026-09-04 (web-verified). Used: Dialog, Tooltip, Button, Input, Separator, merge-props/use-render. No Popover/Menu/Drawer/Combobox. |
| S14 | "Since last visit" should be generalised | CONFIRMED (Home-only today) | `components/home/change-line.tsx:38`, cursor `nour:hq-last-visit`, one tRPC (`operator.briefChanges`), one consumer (`home-console.tsx:105`). Brain's `continuity-view.tsx` computes its own 24h/7d deltas. |
| S15 | `/system/chat-states` exists; build `/system/ui-lab` | CONFIRMED / REFUTED | `app/(mastery)/system/chat-states/page.tsx:5-15` is the deliberate no-Storybook gallery. No ui-lab route. |
| S16 | MetricDatum data grammar | PARTIAL (a sibling exists) | `lib/services/metric-result.ts:19-24` is the three-state substrate (`ok`/`degraded`/`unavailable`, `source`, `measuredAt`, `sampleSize`). Baseline/delta live in `components/ui/trend-counter.tsx:78-86`; freshness in `ui/freshness-chip.tsx`. Five conventions, never one type. |
| S17 | Reality Mode overlays "H0/H1/H2" on claims | PARTIAL, and the ledger is bigger than the plan says | The Reality Ledger has SIX grades H0-H5 (`prisma/schema.prisma:3568-3575`, `lib/services/reality-ledger.ts:18`), `quality: observed/derived/inferred` (`:3602-3603`), claim supersession (`:3628-3630`). `H1`/`H2PLUS` elsewhere are EFFORT bands (`lib/domain.ts:22`). The commit-gateway evidence ladder (`lib/brain/memory-commit-gateway.ts:46-54,87-97`) is the per-memory vocabulary; its only UI label map is local to `components/home/brain-node-detail-panel.tsx:62-71`. |
| S18 | Time Travel ("what did StateNour believe on Aug 1") | PARTIAL: engine yes, UI no | `lib/brain/contextual-recall.ts:598-662` (`validityWhere`, `isVisibleAsOf`, `validitySql`), `lib/brain/query-plan.ts:168-169` (`parseAsOf`), tool param `lib/ai/tools/brain.ts:299-333`. No UI control anywhere. Production probe 2026-09-08: 0 of 40,889 rows carry `valid_from` (`docs/CURRENT-TRUTH.md`, BDN-310 entry) -- the write path does not stamp validity; that is Brain plan Wave 2, not UI work. |
| S19 | "Explain this" priority breakdown | PARTIAL | A machine sentence exists (`lib/scoring/task-priority.ts:244-263` -> `next-move.ts:185` -> `deck-next-move.tsx:137-140`); no per-term breakdown, though `NOW_WEIGHTS` (`task-priority.ts:28-45`) makes one computable. |
| S20 | React 19.3 shipped 2026-09-09 with stable `<ViewTransition>`; catalog is ^19.2.0 | CONFIRMED | react.dev/blog/2026/09/09/react-19-3 (web-verified); `pnpm-workspace.yaml` catalog `^19.2.0`, resolved 19.2.6. Upgrade = lockfile change touching BOTH apps -> its own PR. |
| S21 | "Do it only after the current StateNour CI issue is resolved" | STALE | PR #2334 (merged into `main` today) shows 15/15 checks green: typecheck, e2e, security, knip orphan gate, ast-grep + depcruise, gitleaks, adapter parity, completion-authority. The 2026-09-08 `Adoption gates` failures are resolved. |
| S22 | A2UI (`createSurface`/`updateComponents`/`updateDataModel`), AG-UI interrupt lifecycle, MCP Apps (ui:// resources) | CONFIRMED (external) | a2ui.org/specification/v1.0, docs.ag-ui.com/concepts/interrupts, modelcontextprotocol/ext-apps 2026-01-26 -- all web-verified. Chat already has two structured renderers: `components/chat/tool-result-registry.tsx` (1,244 lines) and `features/chat-v2/components/typed-tool-cards.tsx` (159 lines, deliberately restarted small). |

### 1.2 Per-page claims

| Page | Verdict | Receipt / correction |
|---|---|---|
| Home: six-part model, <=7 budget, since-last-visit | CONFIRMED | `components/home/home-console.tsx:6-15`; `lib/home/operator-brief.ts:55-59` (`ATTENTION_CAP = 7`, tripwire `tests/home/operator-brief.test.ts:49-52`). Caveat: sections 5-6 already form a sticky right rail at >=1280px (`home-console.tsx:97-106`). |
| Missions: Next Move -> ... -> Evidence | CONFIRMED (order), PARTIAL (shape) | `missions/page.tsx:8-18`; render order matches. Two-column at xl (`:256`), sections 8-9 are a rail (`:426`), and an unnumbered `TaskFilters` block sits at `:350`. |
| Chat: memory context, quality, posture/depth/private, history, voice, media | CONFIRMED | `features/chat-v2/stores/chat-ui-store.ts:35-41`, `chat-island.tsx:282-302,347,359`, `components/chat/quality-bar.tsx`. |
| Brain: nine tabs, five groups in a comment | CONFIRMED, group name corrected | `brain/page.tsx:71-81` (nine), `:56-68` -- groups are **MAP / RULE / LIBRARY / THINK / PULSE**, not "REVIEW". Graph trust encodings: `home-brain-graph.tsx:24-26,74-85,567-576,599-600`. |
| People: ~1,000-line Power Atlas with all listed sections | CONFIRMED | `people/page.tsx` = 1,016 lines; `components/power-atlas/*` = 2,596 lines across 14 files; every named section has an import at `:36-63`. |
| Stats: "Premium Glassmorphic Navigation Bar", blue-indigo-purple underline, RPG leveling | CONFIRMED | `stats/page.tsx:151`, `:170` (carries an `anti-slop-allow` escape hatch -- the gradient is exempted from `check:anti-slop`, which is why it survives), `:8,43-44`. |
| Photo Improver: violet active mode | CONFIRMED; flow wording PARTIAL | `photo-improver/page.tsx:216-224`; documented flow is upload -> analyze -> rebrand -> send (`:11-15`). |
| Content: Drafts / AI Assistant / History / Publish / Outreach | CONFIRMED | `content/page.tsx:43-49`. |
| Learn = Build Your Own X catalog; the active loop moved | CONFIRMED | `learn/page.tsx:1-6`; the loop is `components/actions/mode-learn.tsx` (1,170 lines) inside a `/stats` accordion (`stats/page.tsx:78-83`). |
| Pins know staleness, token cost, top-5 injection | CONFIRMED | `pins/page.tsx:6-12,65-71,292`; `lib/pins/injected.ts:18-23`. |
| Links: CRUD table, add sparkline/health | CONFIRMED (table) / no series exists to sparkline | `links/page.tsx:245-249`; `ShortLink` carries a scalar `clickCount` only (`:11-19`); raw `fetch` + `useState`, the last page off tRPC. |
| Settings: four domains | CONFIRMED | `components/settings/settings-console.tsx:35-57`. |
| System: Needs-attention lift, measured/unmeasured honesty | CONFIRMED | `components/system/hub-grid.tsx:12-14,54-58,85,501-512`. `unknown` is deliberately NOT lifted. |
| Journal mobile order composer -> intelligence -> feed | CONFIRMED | `journal/page.tsx:56-64,68-83`. |
| All 15 named `/system/*` routes exist | CONFIRMED (16 exist) | `/system/cockpit-observability` is an 18-line shell with a hub card at parity with 700-line surfaces. |

### 1.3 What the plan did not mention (material to any redesign)

1. **`/proof` exists, is fully built, and is unreachable** -- `app/(mastery)/proof/page.tsx` (132 lines) reads the Reality Ledger; zero references in nav, hub, palette or links. Its honest "Ledger not migrated yet" banner (`:34-41`) keys on `proofSummary().ledgerAvailable`. Fixed on this branch: one NAV row (§4.9).
2. **`docs/design/warroom-spatial-os-phase1.md` (2026-07-05)** -- a validated, unbuilt "Spatial OS" design (pannable canvas, tiles, drag task->mission). Different thing from the plan's "Spatial Workbench" (an object grammar, not a canvas). Its decisions that transfer: D7 "DOM + CSS transform + zustand, zero new deps", "TanStack Virtual deferred until >30 tiles", and "phone list UI untouched".
3. **`docs/research/2026-09-07-statenour-quality-power-program.md` §5** already owns the plan's cosmetic items: §5.1 type floor, §5.2 colour semantics (retire the violet AI accent), §5.9 real `<h2>` eyebrows, §5.10 copy voice. §5.3/5.4/5.8 shipped in #2202 (flat header, no in-page blur, second column at 1280px, 24px targets, focus clears the tab bar). The plan's items 7-8 are that program's open items, not new work.
4. **`docs/audits/IA-REORG-DESIGN.md`** -- the IA reorg the plan's item 3 builds on already shipped (`nav-items.ts:18-33`).
5. **`components/ui/empty-state.tsx:51-54`** type-gates the plan's Constitution #10 ("unknown is visually different from zero"): `provenance: ZERO | UNMEASURED | ERROR | SUPPRESSED`, and `tone: "positive"` only compiles with `ZERO`. The 2026-09-10 "Empty is not error" wave (#2271) closed five more instances. This is the house rule, not a proposal.
6. **`components/home/brain-node-detail-panel.tsx`** (349 lines) is already a memory inspector for graph nodes: evidence class, seen x N, age, TTL, contradiction involvement, stored neighbourhood via `trpc.brain.graphNeighborhood` ("a working service that had ZERO consumers until this panel"). Bottom sheet on phones.
7. **`components/mastery/nick-side-pane.tsx`** is already the persistent right pane (380px desktop / 80vh sheet, 5 routes) and reserves `--nick-fab-lane` on `<html>`; a second right-edge panel must coexist with it (§3.4).
8. **z-index has no scale**: 9500 / 200 / 180 / 120 / 100 / 70 / 59 / 58 / 56 / 55 / 50 / 40 across the bespoke overlays. New layers need an explicit slot.
9. **`tests/repo/ui-mount-graph.test.ts`** rejects any component no entrypoint reaches; the CI knip gate rejects new unconsumed exports. Together they make "substrate first, pages later" un-mergeable.
10. Two things called "ledger": `app/(mastery)/intelligence/ledger/page.tsx` (`DecisionLedgerPage`, opportunity queue) and the Reality Ledger. `/intelligence/brief` and `/intelligence/ledger` are live and unnavigable; `/goals` and `/scoreboard` are redirect tombstones.
11. `lib/feature-flags.ts:16` says `/system/migrations` renders the registry; that page is gone. The registry is write-only.
12. `components/hud/keyboard-shortcuts.tsx:45,49,50` route `G D / G Q / G P` to `/system/devices`, `/system/quality`, `/system/power` -- none exist. Cmd+K is bound in three independent listeners (`:60-70`, `command-palette.tsx:151-182`, `hooks/chat/use-chat-keyboard.ts`).
13. The plan's proposed Reality Mode shortcut Cmd+Shift+R is already taken by the browser on macOS (Chrome: hard reload; Safari: Reader view). Not bindable; Reality Mode lives under Cmd+K → Modes.

### 1.4 Technology verdicts (rows added to `docs/UPSTREAMS.md`)

| Technology | Verdict | Grounds |
|---|---|---|
| React 19.3 `<ViewTransition>` | WATCH | Stable since 2026-09-09. The catalog pin `^19.2.0` resolves 19.2.6; bumping touches `pnpm-lock.yaml` for both apps -> a dependency PR of its own. Trigger: this branch merged and the inspector open/close + row->inspector transitions named as the first two consumers. Never "fade every route". |
| Base UI 1.8 | ADOPT-CANDIDATE (own PR) | 1.4.1 installed. Popover/Menu/Combobox unused today; the inspector's phone sheet is hand-rolled to match `more-sheet.tsx` and `nick-side-pane.tsx` (the house sheet), not a Base UI Drawer. Revisit when a menu/popover is needed. |
| TanStack Virtual | WATCH (installed, unused) | Adopt on a NAMED list >200 rows the operator scrolls (Brain memories, `/system/logs`). Declared-and-unused since 2026-05. |
| Observable Plot | WATCH | Real value for Stats/Calibration analytical views; new dep; not before the Stats surgery is scoped. |
| A2UI / AG-UI / assistant-ui | PATTERN | Take the vocabulary (surface/components/data separation; interrupt = approval + edited args + idempotency). Chat already has two typed renderers; a third protocol without consolidating those two would be a fourth taxonomy. |
| MCP Apps | WATCH | Compatibility target once the typed-card registry is one registry. |
| FINOS Perspective | REJECT for now | No dataset the operator browses ad hoc exceeds what a virtualised list serves; a WebGL grid is a second UI system. Trigger: a named dataset >10k rows with an operator workflow. |
| Sigma.js / React Flow | WATCH / REJECT | Custom canvas graph stays (its own contract, `home-brain-graph.tsx:24-26`); `MemoryEdge` had ~57 rows on 2026-07-05. |
| React Spectrum AI components | STUDY-ONLY | Reference for behaviour; no second primitive stack. |

---

## 2. My spin: five corrections to the plan

1. **Evidence is the product, so PROOF is slot one, not Wave 7.** The repo's real asset is its truth
   architecture (evidence ladder, Reality Ledger grades, `EmptyState` provenance, the "empty is not error"
   wave). The plan treats "Reality Mode" as late-stage novelty. Inverted: every inspector renders an
   `EvidenceMark` from day one using the EXISTING vocabulary (`MemoryEvidenceClass`, `trustTier`,
   `validFrom/validUntil/supersededById`), and Reality Mode is a persisted toggle that expands those marks
   inline. Cost: ~150 lines. It ships in slice 1.
2. **Vertical slices, because the gates say so.** `ui-mount-graph.test.ts` + knip mean a primitive with no
   consumer is a red PR. Each primitive here lands with its first consumer and a test that failed first.
3. **Object identity is shared with the backend, not invented for the UI.** `EntityRef = { kind, id }` is
   the Reality Ledger's `objects[].{type,id}` shape (`reality-ledger.ts:23`) and the graph neighbourhood's
   `{type,id}` (`brain-domain.ts:823`). A UI focus can become a ledger event; a ledger claim can deep-link
   back. That is the interoperability the plan wants from "NourUI", with zero new protocol.
4. **Time Travel is gated on the Brain plan, not on UI.** The as-of engine exists; the data does not
   (`valid_from` on 0 rows). The inspector shows validity/supersession now; the scrubber waits for Wave 2
   of `docs/research/2026-09-08-statenour-brain-intelligence-upgrade-plan.md`. Saying otherwise would be
   building a control over empty columns.
5. **No desktop left rail, no cosmetic pass.** The design pass already gave Home and Missions a context rail
   at 1280px; the inspector is the desktop's spatial shell. The plan's 2% "make it prettier" is right; the
   §5 program owns the type floor and colour semantics.

---

## 3. The object grammar shipped on this branch

### 3.1 Five slots, one interaction

`FOCUS -> PEEK -> INSPECT -> ACT -> PROOF -> TIME`, expressed as:

| Slot | Mechanism | Where |
|---|---|---|
| FOCUS | any element with `data-entity="<kind>:<id>"` inside a `[data-selection-scope]`; roving focus with j/k/Up/Down; `x` toggles selection, Shift+Up/Down ranges | `lib/ui/selection-model.ts` (pure), `hooks/use-selection-keyboard.ts` |
| PEEK | Space opens the inspector transiently (no URL change), follows the focused row; Esc closes | `lib/state/inspector-store.ts` `peek` |
| INSPECT | Enter / click / Cmd+K -> `?inspect=<kind>:<id>` (push, so Back closes it); close = replace without the param | `lib/ui/inspect-url.ts`, `hooks/use-inspector.ts` |
| ACT | per-kind action descriptors, rendered in the inspector footer, the selection bar and the palette's "Focused object" group | `lib/ui/entity-actions.ts` |
| PROOF | `EvidenceMark` (chip + tooltip; inline when Reality Mode is on) | `components/ui/evidence-mark.tsx`, `lib/brain/evidence-label.ts` |
| TIME | validity interval + supersession chain in the memory inspector; `asOf` reserved, not built | `lib/services/brain/memory-detail.ts` |

### 3.2 EntityRef (closed registry)

`lib/ui/entity-ref.ts` -- `task · mission · goal · person · memory · reflection · decision · journal · pin ·
claim · alert · cron · tool · device · experiment · content`. Wire form `<kind>:<id>` (ids may contain
colons; the first colon splits). Unknown kinds parse to `null` -- the URL cannot smuggle a type in.
`toPageContextAnchor(ref)` maps to the bridge's field names so Nick sees the inspected object.

### 3.3 Inspector host

`components/inspector/inspector-host.tsx`, mounted once in `app/(mastery)/layout.tsx`. Reads `?inspect=`
(Suspense-wrapped, the `page-tabs.tsx` pattern) or the store's `peek`, looks the kind up in the static
registry (`components/inspector/inspector-registry.tsx`), and renders `InspectorFrame`:

- **>= xl (1280px):** non-modal right panel, 380px, `role="complementary"`, docked left of the Nick pane
  when that is open (`--nick-pane-open-w`, published by `nick-side-pane.tsx`), and it reserves
  `--inspector-lane` on `<html>` so `<main>` reflows instead of being covered.
- **< xl:** bottom sheet, `role="dialog" aria-modal`, scrim, Esc, drag handle, safe-area padding -- the
  `more-sheet.tsx` / `nick-side-pane.tsx` chrome, z-index slot 60/61 (above the Nick sheet at 58/59, below
  MORE at 70).
- Unknown kind, failed read, and not-found each render a distinct honest state (`EmptyState` provenance
  `UNMEASURED` / `ERROR` / `ZERO`), never a blank panel.
- A page can declare it OWNS a kind (`useInspectorOwnership(["person"])`) so the host stays silent there
  and the page's own panel answers the URL -- how `/people` keeps its dossier panel and still becomes
  URL-addressable.

### 3.4 Renderers shipped (five kinds, two slices)

| Kind | Read | Shows | Entry points wired |
|---|---|---|---|
| `memory` | new `trpc.brain.memoryById` -> `lib/services/brain/memory-detail.ts` (soft-delete filtered) | content, category, evidence class + provenance, trust tier, seen x N, age, TTL, validity interval, supersedes / superseded-by chain, neighbourhood | Cmd+K semantic hits; Brain "Changed" rows; the graph node panel's Inspect action; any `?inspect=memory:` link |
| `task` | `trpc.task.byId` (now `activeOnly`; carries `priorityBreakdown` + `priorityManual`) | next physical action, definition of done, mission, status, due, effort/energy/context, waiting-on, and WHY: the scorer's per-term breakdown (`PriorityBreakdownView`: terms largest-first with bars, multipliers, `Σ × factor → score`), the manual-override line, or the stored string as the deploy-window fallback | Missions task rows (44px eye button; title keeps edit, pencil keeps the sheet), keyboard from the mission board scope, chat tool links via the bridge fix, Home brief lead (Inspect beside the CTA) |
| `person` | `trpc.task.personProfile` (page-owned on `/people`, statically via `ROUTE_OWNED_KINDS`) | the existing dossier panel, now at `?inspect=person:<id>` | People list rows |
| `alert` | `trpc.brain.memoryById` (alerts ARE BrainMemory rows) | category, age, content, key, evidence chip; verbs: resolve (two-tap, soft-delete, closes) · mute category 7d — the ActiveAlertsCard's procedures | `/system/alerts` rows (eye button, selection scope) |
| `cron` | `trpc.systemAutomation.cronDeck` (row) + `cronRunHistory` (7d, 12 runs) | schedule, mode / kill state, description, last + next run, success-rate / median / p95 as Metrics (95-100 band), counts, runs with error previews; ZERO empty state for no runs, not-found for a name the deck lacks | `/system/crons` rows (eye button in the name cell, per-category selection scopes) |

Actions available on every kind: Open on its page · Ask Nick (prefilled `/chat?prompt=`) · Add to workset ·
Copy link (the object's canonical route). **Page-lent actions** (slice 2): a page registers verbs for a kind
with `useRegisterInspectorActions(kind, actions)` (store `pageActions`, released on unmount); the Missions
board lends complete / snooze-tomorrow / snooze-next-Monday through its OWN `useMissionDispatch` handlers,
so the inspector runs the board's optimistic update, completion prompt and telemetry — one mutation path.
Off the board the footer says where to act instead of showing dead buttons. Alert verbs are inspector-owned
because the list had none; cron run-now / kill stay on the row, where their pending state and confirm live.

### 3.5 Workset

`lib/ui/workset.ts` (pure: horizons `session` 8h / `today` local midnight / `week` next Monday 06:00 /
`until-resolved` no expiry; cap 7; dedupe by ref) + `lib/state/workset-store.ts` (localStorage
`nour:workset:v1`) + `components/workset/workset-shelf.tsx` (renders nothing when empty; chips open the
inspector). Consumed by the palette ("Workset" group) and the inspector footer. Nick integration (a
`workset` field on the chat request) is the next step and is NOT claimed.

### 3.6 Metric grammar

`lib/ui/metric-datum.ts` is a presentation layer over the existing `MetricResult<number>`
(`lib/services/metric-result.ts`), not a new state type: `unit`, `window`, `baseline`, `range`,
`higherIsBetter`. `describeMetric()` never emits a number for `unavailable`, marks `degraded` as stale,
and formats delta vs baseline with `trend-counter.tsx`'s rules. First consumer: the person inspector's
cadence line ("usual every 8-12d · current gap 29d").

### 3.7 Not built, and why

- **ChangeSet / universal "since last visit"** -- one live consumer (Home); Brain's Changed view computes
  its own deltas server-side. Generalise when a second consumer with a cursor exists.
- **Page archetypes** -- a layout prop that no page consumes is a knip orphan. The table stands as design
  intent (Command / Workspace / Stream / Lab / Control Tower / Utility); adopt it when Brain or People are
  restructured.
- **Desktop left rail, Time Travel scrubber, Counterfactual mode, semantic zoom, NourUI protocol** --
  see §5. (Priority breakdown and the UI Lab route were on this list in slice 1; both shipped in slice 2.)

### 3.8 Hostile review of slice 1 — what it found, what changed

An adversarial read-only pass over the slice-1 diff (2 P1, 8 P2, 8 P3; none in `tsc`, all in behaviour)
landed as commit `ba227588a`, each fix with a test where the shape allows:

- Selection / focus / peek survived route changes and could not be cleared off a scoped page → the hook's
  cleanup calls `resetTransient()`; Clear falls back to the store.
- `/people` deep links SSR-rendered the global sheet over the dossier (ownership was effect-time) →
  `ROUTE_OWNED_KINDS` is static; the host renders nothing until mounted, which also ends the desktop
  scrim-then-dock flash.
- One Esc closed two layers (MORE sheet never moves focus into itself; the Nick pane's window listener) →
  the hook yields when any foreign modal is open on the document and while the pane is open.
- Tab-reached rows (`role="button"`) ignored Enter → the grammar adopts the DOM-focused row.
- The docked panel was overlapped by the FAB and the selection bar, and covered content with the Nick pane
  open → the lane is panel + pane width; the bar and the FAB stand clear of it.
- Sheet a11y: two controls named "Close inspector", no focus move → scrim `aria-hidden`/`tabIndex=-1`,
  focus lands on the header close button.
- `getTaskById` had no soft-delete filter (a deleted task rendered as live from a stale workset chip) →
  `findFirst` + `activeOnly`; `task.byId` id cap 200; a deleted `supersededBy` is no successor.
- Palette Inspect / Workset went through `router.push` (scroll-to-top, no replace) → `openInspector`;
  store setters no-op on equal input; Copy link copies the canonical route; peek skipped for page-owned kinds.
- `font-[var(--font-display)]` was being read as a font-WEIGHT arbitrary value and dropped by
  tailwind-merge against `font-bold` (visible in the UI Lab render) → the `.font-display` class.

Not taken from the review: recolouring the graph panel's `prediction` chip back to violet (the header of
`lib/brain/evidence-label.ts` records the change; zinc is the doctrine — no purple as "AI").

---

## 4. Files touched on this branch (ownership map for the sibling session)

A second session is working on statenour structure/UI in parallel. To avoid stepping on each other:

**Created (mine, safe to ignore):** `lib/ui/{entity-ref,inspect-url,selection-model,workset,metric-datum,
entity-actions}.ts`, `lib/state/{inspector-store,workset-store}.ts`, `lib/brain/evidence-label.ts`,
`lib/services/brain/memory-detail.ts`, `hooks/{use-inspector,use-selection-keyboard}.ts`,
`components/inspector/**`, `components/workset/**`, `components/ui/{evidence-mark,metric}.tsx`,
`tests/ui/**`, `tests/components/inspector-*.test.tsx`, `tests/services/memory-detail.test.ts`,
`tests/state/*-store.test.ts`, this document.

**Edited (surgical; please merge, do not rewrite):**
1. `app/(mastery)/layout.tsx` -- two mounts + one class on `<main>`.
2. `components/chat/page-context-bridge.tsx` -- reads `?inspect=`; accepts `#task-<id>`.
3. `components/command-palette.tsx` -- "Focused object" + "Workset" groups; memory hits open the inspector; Reality Mode toggle.
4. `components/hud/keyboard-shortcuts.tsx` -- cheatsheet rows for the new keys.
5. `components/brain/continuity-view.tsx` -- memory rows open the inspector.
6. `components/home/brain-node-detail-panel.tsx` -- imports the shared label map; Inspect action.
7. `app/(mastery)/people/page.tsx` -- the selection IS `?inspect=person:` (the old `useState` copy is gone);
   ownership registration; a Suspense boundary for `useSearchParams` (the stats/logs precedent).
8. `components/missions/mission-task-row.tsx` + `app/(mastery)/missions/page.tsx` -- `data-entity` on rows, selection scope on the board, a 44px eye button opens the inspector (title tap still edits — a title-as-button would have failed the e2e 44px target floor).
9. `components/layout/nav-items.ts` -- `/proof` row under OPERATE.
10. `components/mastery/nick-side-pane.tsx` -- publishes `--nick-pane-open-w` while open.
11. `app/(mastery)/system/chat-states/page.tsx` -- inspector-frame states section (the UI Lab seed).
12. `lib/trpc/routers/brain.ts` -- `memoryById` procedure (append).
13. `docs/DESIGN.md` (append), `docs/UPSTREAMS.md` (rows at the top of the table), `docs/RECONCILIATION.md`
    (entry at top), `.remember/now.md` (entry at top).

**Not touched, by design:** `lib/services/reality-ledger.ts`, `lib/ai/**`, `app/api/ai/chat/**`,
`lib/feature-flags.ts`, `config/agent-os/**`, `prisma/**` (no migration), anything the open PR #2335 edits.

---

## 5. Build order after this branch (NOW / NEXT / LATER / KILL)

**NOW (this branch):** slice 1 — substrate + memory/task/person slices + Reality Mode + Workset + `/proof`
nav; slice 2 — the hostile-review fixes (§3.8), `/system/ui-lab`, the priority breakdown + page-lent
actions, alert + cron inspectors, Inspect on the Home brief lead.

**NEXT:**
1. Tool inspector (kind `tool`, the registry at `/system/tools` -- the last System kind without a renderer)
   and a `device` renderer once the camera-bridge heartbeats land (ADR-0017).
2. `ChangeSet` with Brain's Changed view as the second consumer; then People ("cadence crossed threshold").
3. Base UI 1.8 + React 19.3 dependency PR; then `<ViewTransition>` on row -> inspector only.
4. The program's §5.1 type floor on `bottom-tab-bar.tsx` / `more-sheet.tsx` (9px -> 11px) -- with the
   chat-states screenshot baselines re-cut in the same PR, since they pin the bottom chrome.
5. `execution-panel.tsx` still carries its private copy of the snooze presets; import
   `lib/missions/snooze-presets.ts` there when that file is next touched.
6. A browser-level test for the selection grammar (route-change reset, one-Esc-one-layer) -- the two P1s
   of §3.8 live in DOM code that the Node vitest lane cannot exercise; Playwright is the instrument.

**LATER:** Time Travel scrubber (after Brain Wave 2 stamps `valid_from`); page archetypes on the first
restructured page; TanStack Virtual on the first named long list; Observable Plot with the Stats surgery;
a `workset` field on the chat request; consolidating the two chat typed-card registries before any NourUI
protocol; hidden-episode UI evaluation once the UI Lab has more than one gallery.

**KILL / do not re-propose:** Perspective (no dataset warrants a WebGL grid); React Flow for Brain;
Cmd+Shift+R as a shortcut; a desktop left rail before the inspector has been used for a month; a fourth
tool-card taxonomy; any styling pass that is not one of the §5 program's numbered items.

---

## 6. UI Constitution (appended to `docs/DESIGN.md`)

Twenty rules, kept verbatim from the plan where the code already obeys them and marked where a gate
enforces them. See `docs/DESIGN.md` § "UI Constitution".
