# War-Room Spatial OS — Phase 1 Design

> **Status:** Design validated (brainstorming complete). Not yet implemented.
> **Date:** 2026-07-05 · **Surface:** `apps/statenour` → bdnick.info · **Branch when built:** `statenour/warroom`
> **Method:** two multi-agent design panels (17 + 4 agents) with adversarial verification against the live codebase.
>
> **Epistemic legend:** ✅ = verified against source (carries `file:line`) · ~ = estimate/assumption · ⚠ = risk/open · `[VOLATILE]`/`[CHECK]` = DB/registry snapshot that drifts — re-verify before citing · file:line accurate as-of this commit.

---

## 1 · Understanding Summary

- **What:** a **desktop-primary spatial "OS" layer** for NOUR OS where the existing agentic backend (brain/pgvector, missions, 114-tool catalog, reasoning engine, autonomous engine) becomes **direct-manipulable visual objects** on a pannable/zoomable canvas, instead of ~40 nav routes.
- **Why:** the *agentic* engine already exists; the missing layer is **embodiment** — making the intelligence visible, alive, and manipulable so it reads as a different class of system, and eventually a faster daily driver.
- **Who:** the operator (Nour), solo power-user, desktop-primary for this surface.
- **Shape:** phased — Phase 1 = **one genuinely-real spatial surface** (`/warroom`), then migrate daily workflows onto the canvas only where spatial beats a list.
- **North-star test:** the OS must beat *"why not just browser tabs?"* Its only valid answers are **cross-surface persistent state + agent presence + inter-object direct manipulation.**

## 2 · Assumptions

- ~ The desktop canvas is used on a large screen (laptop/desktop/iPad); the **phone keeps its existing list UI untouched** (operator confirmed).
- ~ n=1 operator in Phase 1 → YAGNI on multi-tenant, audit-grade idempotency ledgers, and durable layout tables.
- ~ "Feels alive" is the make-or-break felt quality; it is **unproven** until the Slice-0 spike (see §7).

## 3 · Non-goals (confirmed)

- **Not** a rewrite — wraps the existing brain/API; does not replace it.
- **Not** replacing the phone PWA; no WebGL/drag shipped to the phone.
- **Not** Phase-1 breadth — one killer surface, not 40 mediocre windows.
- **Not** the Neural Constellation as the Phase-1 hero — explicitly **deferred** to a later tile (§6.6).

## 4 · Decision Log

| # | Decision | Alternatives | Why |
|---|----------|--------------|-----|
| D1 | **War-Room canvas** is the Phase-1 spine; constellation deferred | Constellation hero; Swarm-Deck spine | Only War-Room's signature gesture is a **verified real Neon write** with no ephemeral-state trap. Constellation's daily value already ships as ⌘K search; its Phase-1 slice is hollow (see D6). Adversarial panel: War-Room ~5.3 vs Constellation ~3.7 *(LLM adversarial-judge averages, 3 lenses — not empirical benchmarks)*. |
| D2 | **Killer gesture = drag task → mission** | research→mission attach; task→goal link | Lowest-risk **verified** mutation shape; both tiles reflect it; persists to a non-nullable FK. |
| D3 | **Tiles = Missions + System Pulse + Live-Pulse** | swap Pulse→Money; decide later | Operator's chosen morning-triage set. |
| D4 | **Working approvals** (execute for real), not read-only glow | read-only glow (panel's rec) | **Operator override.** Doubles as fixing a real latent bug (§6.5). Requires durable re-dispatch + a sweeper. |
| D5 | **localStorage** for window layout; **no Prisma migration** in Phase 1 | `DesktopLayout` table now | Dodges the hand-applied `statenour-migration` / pgvector-drop hazard; sufficient for n=1. |
| D6 | **Defer Neural Constellation** to a later tile on this same canvas | ship as Phase-1 hero | ✅ `MemoryEdge` ~57 rows today `[VOLATILE]` → *(inference)* would render only a handful of nodes, not a galaxy; id-space mismatch (`MemoryEdge`↔`vector_embeddings`); silent dimension filter. Building the widget runtime first earns it the right to become a tile. |
| D7 | Rendering = **DOM + CSS transform + zustand**, zero new deps | Three.js / @xyflow / Konva | ✅ For rectangular windows, DOM+transform is the reasoned choice for rectangular windows (glassmorphism fidelity + a11y focus, no canvas lib needed); ~60fps is a **target, not measured** — verify in Slice 1. TanStack Virtual deferred until >30 tiles. |

## 5 · Verified ground truth (implementation rests on these)

**Brain / constellation (deferred, but the data is real):**
- ✅ Explicit graph edges exist: `MemoryEdge` (`schema.prisma:1888`, ~57 rows `[VOLATILE snapshot 2026-07-05]`) + `SemanticEdge` (cosine-derived, `schema.prisma:1477`). No synthesis needed — but seed is tiny today.
- ✅ pgvector KNN ready: `lib/db/pgvector.ts` `knnSearch()`, 1536-dim HNSW.
- ✅ Existing 2D force-directed graph: `components/home/home-brain-graph.tsx`; APIs `/api/brain/graph` + `/api/brain/graph-neighborhood` (`buildGraphNeighborhood`, 1–2 hop).

**Live-state / "it's alive":**
- ✅ SSE keepalive primitive: `lib/streaming/heartbeat.ts` (`withHeartbeat`, generic ReadableStream wrapper).
- ✅ Per-request reasoning SSE: `app/api/nick/reason/stream/route.ts` — streams steps, closes on `done` (request-scoped, NOT a persistent bus).
- ✅ System state is **polled**: `app/api/system/pulse/route.ts` + `lib/services/system-pulse.ts` (6-query fan-out, 30s cache, read via `system.pulse` tRPC).
- ⚠ **No persistent server→client state bus exists.** A live desktop needs one built (or an accepted poll-based ambient life). This is the load-bearing unknown (§7).

**Killer gesture (verified mutation shape):**
- ✅ `trpc.task.update({ id, fields: { missionId } })` — top-level `{id, missionId}` **fails typecheck** (`missionId` lives inside `fields` via `taskUpdateSchema = taskBaseSchema.partial()`). `updateTask` calls `ensureMissionExists`; `Task.missionId` is a non-nullable FK.
- ✅ Refresh via optimistic `utils.task.list.setData` + `utils.task.*.invalidate()` — **NOT** `notifyDataChanged` (the missions tile refreshes via `refetchInterval` + tRPC `utils.invalidate`; it does **not** subscribe to the CustomEvent bus → the card would lag 15–30s and feel dead). Source: `use-missions-data.ts`.

## 6 · Final Design

### 6.1 The surface
`/(mastery)/warroom` — desktop-only, pannable/zoomable canvas: `transform: translate(panX,panY) scale(zoom)`, zustand-held pan/zoom, `will-change:transform`, wheel-zoom + drag-pan + keyboard pan (arrows) + gold `:focus-visible` ring from `globals.css`. Zero new deps.

### 6.2 The three tiles (all real data)
1. **Missions** — reuses `useMissionsData` 5-query fan-out + `MissionFeed`/task-card components. Owns the killer gesture. ⚠ `MissionFeed` hard-depends on `useMissionDispatch`/`MissionDispatchProvider` — stand that provider up inside the tile (budget ~½ day, not a drop-in).
2. **System Pulse** — reuses `system.pulse` tRPC (flat scalars: `cronFails`, `aiErrorRate`, `actionsPending`, `devicesOffline`).
3. **Live-Pulse** — ambient-life: a **fetch-streamed SSE** read (POST) of `/api/nick/reason/stream` — `res.body.pipeThrough(TextDecoderStream)`, frames split on `\n\n`; **not** `EventSource` (GET-only) — when a reason run is active (steps accrete live) + `ApprovalRequest` rows with `status=pending_approval` as amber glass cards.

### 6.3 The killer interaction
Grab a task card out of Missions, drop it on another mission's header → fires `trpc.task.update({ id, fields: { missionId } })` (verified shape) → optimistic `setData` re-homes it instantly → `invalidate` reconciles on settle. One gesture, one Neon write, both tiles reflect it, it sticks in the DB.

### 6.4 Layout persistence
Window `x/y/z/w/h` → **localStorage**. No `DesktopLayout` Prisma table in Phase 1 (D5).

### 6.5 Durable approvals (operator's scope-up — the hardened design)

**The bug being fixed** (✅ verified): on Railway restart/multi-instance, the process-local `pendingExecutions` Map (`lib/tools/guardian.ts:32`) is empty, so `executeApprovedToolAsync` (`guardian.ts:52-102`) falls back to `TOOL_MAP` (`guardian.ts:35-41`, only 5 entries) → `shop.sendSms` isn't there and can't be (it's a cross-system `callNickstire('smsBot.send')`, `shop-actions.ts:79-82`). Row flips green, **tool never fires.**

**Core mechanism** (✅ verified sound by the adversarial pass):
- **Reuse `executeActionWithoutTracing({type,params})`** (`nick-agent.ts:214`) as a **third dispatch tier**. Its switch already has `case 'shop.sendSms' → handleShopSendSms` (`:293-294`) reading `{phone,message}` — the exact shape both producers persist on `ApprovalRequest.payload`. Export it; call it after the `pendingExecutions` miss and `TOOL_MAP` miss, inside `guardianBypassStorage.run(true, …)`. **Zero new nourTools entries, no `TOOL_MAP` bloat.**
- **Idempotency = atomic compare-and-swap** on the existing `status` column: replace the unconditional `update({status:'executing'})` with `updateMany({ where:{ id, status:'approved' }, data:{ status:'executing', executedAt } }); if (count !== 1) return;` — the proven `nick-action-execute` pattern. `pending_approval→approved→executing→executed|failed` is a monotonic state machine; `executing` is the claimed sentinel.
- **No migration** — every field already on `ApprovalRequest` (`schema.prisma:2799`): `toolId`, `payload`, `status`, `executedAt`, `resultPayload`; existing `@@index([status])` covers the claim.

**The 6 required corrections** (from adversarial verify — `holds:false` until all done):
1. ⚠ **Auth regression** — `shop.sendSms` is `owner_required` (`tool-registry.ts:540`) but the approve mutation only owner-gates `riskClass==='critical'` (`actions.ts:38`), and the lead-audit producer hardcodes `require_approval/high`. **Fix:** gate `approveApprovalRequest` on `require_owner || riskClass IN ('critical','high')` requiring `session.role==='owner'`, **or** explicitly downgrade `shop.sendSms` and document operator-approval intent. Make code match registry intent.
2. ⚠ **Silent liveness hole** — `void executeApprovedToolAsync` is fire-and-forget across a process boundary; pod death after approve-commit strands the row `approved`, nothing claims it, silent non-delivery. **Fix (required for "actually executes"):** add an **Inngest/cron sweeper** that claims `status='approved'` (and `status='executing'` past a TTL) via the same atomic CAS and drives `executeApprovedToolAsync`. This is what upgrades "durable intent" → "durable delivery."
3. ⚠ **Failure misclassification** — `executeActionWithoutTracing` returns soft `{success:false}` (no throw). **Fix:** branch on `result.success` → `status='failed'` on false; `executed` only on true.
4. **CAS is the only writer** of the `approved→executing` transition (remove the unconditional update, or the CAS is defeated).
5. ⚠ **Payload staleness** (SMS footgun) — a 24h-old row could text the wrong person; `editedPayload` can reshape args. **Fix:** shorten `expiresAt` for external-mutation rows and/or re-validate the target at dispatch; else document verbatim-dispatch as accepted risk.
6. **Import cycle** — `guardian.ts → nick-agent.ts → approval-gate.ts → guardian.ts`. Use the existing **dynamic-import** pattern (`guardian.ts:72` already lazy-imports nourTools) for `executeActionWithoutTracing`; confirm with `pnpm typecheck`.

**Deny path** (✅ unchanged, correct): `rejectApprovalRequest` sets `status='rejected'`; the CAS `where status='approved'` means a rejected row can never be claimed — denied stays denied across restarts.

⚠ **Cross-system non-atomicity** (document, don't fix in Phase 1): the SMS side-effect isn't transactional with the DB claim. If an instance claims → sends → dies before writing `executed`, the row stays `executing` and the SMS already went out. **Safe only because no sweeper re-claims `executing` in Phase 1** — a Phase-2 sweeper relaxing the WHERE to include `executing` must use a **nickstire-side idempotency key** or it double-sends.

### 6.6 Deferred: Neural Constellation
Lands later as **one tile on this canvas**, designed-in from day one. Pre-scoped spec (reuse `buildGraphNeighborhood`, `knnSearch`); fund the id-bridge (`MemoryEdge`↔`vector_embeddings`), the `_1536` HNSW path, and a real seed before it's showable.

## 7 · The load-bearing unknown → Slice 0 gate

**Does the canvas FEEL alive between gestures without building the persistent SSE bus?** The reasoning SSE is request-scoped (dies on `done`); approvals are rare → the ambient tile may be inert 90% of the day (the dead-dashboard trap).

**Slice 0 (throwaway spike, hard gate — no polish until it holds):** prove BOTH —
- **(A) Felt aliveness:** wire only the reasoning-stream **fetch-SSE** (POST `/api/nick/reason/stream`, not `EventSource`) + amber approval poll into a bare tile; confirm a triggered reason run visibly streams and a real pending approval visibly glows — the surface breathes on its own.
- **(B) Drag under transform:** pointer math must invert `translate·scale` to hit-test the drop target in canvas-space (no dnd-kit installed — this is the #1 unbacked risk).

If (A) is inert or (B) is flaky → either commit to a persistent `/api/live/state` SSE bus in Phase 1 (scope up), or reduce ambition. **Decide here, before anything pretty.**

## 8 · Build order (small ships · branch `statenour/warroom` · never `main`)

0. **Liveness + drag spike** (throwaway, gates the whole bet — §7).
1. **SpatialCanvas shell** — `/warroom` route, wheel-zoom + drag-pan in a zustand store, transform-only 60fps, keyboard pan, desktop-only guard.
2. **Thin widget runtime** — minimal `WidgetManifest` registry (`lib/widgets/manifest.ts`, modeled on `TOOL_CATALOG`'s `ToolMeta`), `WidgetWindow` chrome + error boundary, localStorage layout persist. No Prisma table.
3. **Wrap the two read tiles** — Missions (+ stand up `MissionDispatchProvider` inside) + System Pulse.
4. **The killer gesture** — DropZone on mission headers + task→mission drag; verified mutation + optimistic/invalidate. Verify it persists to Neon.
5. **Ambient-life tile (READ)** — reasoning-stream + amber approval glow with state color/animation (gold=thinking, amber=needs-approval, settled fade).
6. **Durable approvals — WRITE core** (~25 LOC): export `executeActionWithoutTracing`; CAS claim; third fallback tier under `guardianBypass`; `result.success` mapping; dynamic-import. + restart-simulated test.
7. **Durability + auth hardening** — owner-auth fix (correction 1); Inngest/cron **sweeper** (correction 2); payload-staleness guard (correction 5).
8. **Ship gate** — `pnpm verify:hard` (typecheck/lint/test) + Railway deploy check.

> Slices 6–7 are the ~2 extra slices the working-approvals override adds beyond the pure War-Room. Honest, and they retire a real latent bug.

## 9 · Non-negotiables

- Killer gesture is a **real Neon write** on first ship — verified shape, no mock.
- Refresh via optimistic `setData` + `utils.*.invalidate()` — **never** `notifyDataChanged`.
- **Slice 0 is a hard gate** — no polish until felt-aliveness + drop accuracy both hold.
- Approvals must **actually fire** (operator requirement) — that means the sweeper (correction 2) is **in scope**, not deferred; "fire-and-forget" alone does not satisfy "actually executes."
- **No Prisma migration** in Phase 1 (pgvector-drop risk).
- Desktop-only — phone list UI untouched.
- Branch `statenour/warroom`; PR; operator merges; `verify:hard` green before done.

## 10 · Open questions for the operator

1. **Liveness ambition:** if Slice 0 proves the surface is inert most of the day, scope UP to a persistent `/api/live/state` SSE bus in Phase 1, or accept poll-based ambient life?
2. **Constellation timing:** park entirely until the runtime + data-traps are funded, or run a parallel throwaway spike to confirm the id-bridge now?
3. **Auth fix direction** (correction 1): enforce owner-role on high-risk approvals, or downgrade `shop.sendSms` to operator-approval and document it?
