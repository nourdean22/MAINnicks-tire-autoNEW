# tRPC Migration Roadmap

> **Track-1 modernization** (legacy-modernizer pass). The REST→tRPC
> strangler-fig migration. This doc is the map: domains, router status,
> slice order, the per-slice protocol. **"Done" =
> `hooks/use-authed-fetch.ts` is deleted** — you cannot half-delete a
> function, so that milestone forces the migration to actually finish.
>
> **Status (2026-05-22 · Phase B in progress):** 7 domain slices merged
> to `main`, all build-verified; the 8th (B.6c) is in flight. ~40% of
> `authedFetch` call-sites migrated. See **Phase B progress** below.

## Current state

- **Modern layer** — 8 typed tRPC routers in `lib/trpc/routers/`:
  `nick · operator · system · chat · browser · task · journal · brain`.
- **Legacy layer** — client files still call `authedFetch` /
  `useAuthedFetch` (`hooks/use-authed-fetch.ts`) to hit REST `/api/*`
  routes. REST routes and tRPC routers coexist (the rollback path)
  until each domain is 100% migrated and soaked.
- The `task` router is the reference implementation (most mature).

## Phase B progress

Slices ship one per commit · each gated (typecheck · `eslint .` · full
test suite) · build-verified by the pre-push `turbo build` hook.

| Slice | Domain | Commit | Status |
|---|---|---|---|
| A    | roadmap (this doc)        | `222bedc4` | ✓ |
| B.1  | journal                   | `f291eaef` | ✓ merged |
| B.2  | settings                  | `13201eeb` | ✓ merged · folded into `system`/`operator`/`brain` |
| B.3a | system widgets            | `7b5c66f4` | ✓ merged · `components/system/*` widgets only |
| B.4  | actions / task            | `bef2a860` | ✓ merged |
| B.5  | chat                      | `be2185bd` | ✓ merged · chat-domain calls; cross-domain residuals deferred |
| B.6a | ultron · operator-domain  | `3c9ce883` | ✓ merged |
| B.6b | ultron · task-domain      | `5627b8e4` | ✓ merged |
| B.6c | ultron · system-domain    | —          | in flight |

Remaining after B.6c: **brain** · **system pages**
(`app/(mastery)/system/*` — the largest chunk, ~26 files) · misc pages ·
`hooks/` · scattered components · chat + ultron cross-domain residuals ·
then **M-done** (delete the helper).

## Inventory — `authedFetch` call-sites by domain

| Domain | ~files | Status | Notes |
|---|---|---|---|
| journal    | 6  | ✓ done    | proof slice (B.1) |
| settings   | 6  | ✓ done    | B.2 · folded into `system`/`operator`/`brain` routers |
| actions    | 18 | ✓ done    | B.4 · `task` router |
| chat       | 20 | ◐ partial | B.5 · chat-domain done; ~7 cross-domain residuals in `components/chat/` |
| ultron/HQ  | 21 | ◐ partial | B.6a operator + B.6b task done; B.6c system in flight; brain/audit/decisions/drift stragglers remain |
| brain      | 22 | ☐ pending | `brain` router · next slice |
| system     | 48 | ◐ partial | B.3a did `components/system/*` widgets; ~26 `app/(mastery)/system/*` pages remain |
| hooks      | 12 | ☐ pending | cross-cutting — migrate alongside owning domain |
| misc pages | 12 | ☐ pending | financial / social / content / body / etc |

Counts are approximate (file-level grep). Non-targets (the
`useAuthedFetch` helper, `migrate-authed-fetch.ts`, router files, docs,
contract tests) are excluded.

## Slice order

Smallest-with-router-first, then scale:

1. journal → 2. settings → 3. actions → 4. chat → 5. ultron/HQ
(sub-sliced: 6a operator · 6b task · 6c system) → 6. brain →
7. system pages. Cross-cutting `hooks/` and misc pages migrate with
their owning domain.

## Per-slice protocol — the strangler-fig discipline

For each domain slice, in order:

1. **Test first.** Pin the domain's current behaviour with a contract
   test — the real client payloads validated against the server Zod
   schema. This guards the typed-payload-mismatch class: the `/tasks`
   quick-add bug (2026-05-21) — a permissive `z.record()` tRPC input
   let a thin payload through to a stricter downstream `.parse()`.
2. **Build / extend the router** — add the procedures the domain needs,
   each delegating to a shared `lib/services/` function the REST route
   also calls (drift structurally impossible). **Every procedure that
   returns Prisma rows MUST have an explicit, shallow return type** —
   never return a raw `prisma.x.findMany({select})` result. Prisma's
   recursive `JsonValue` type (any `Json` column) leaks into
   `AppRouter`, and past a certain total router size trips **TS2589
   "excessively deep"** at unrelated consumer `.useQuery` call-sites
   (the B.6a operator-router growth hit this). The firewall: a flat
   `interface` (Json columns typed `unknown` or projected to scalars),
   cast the procedure's return to it — see `TaskEventRow` in `task.ts`
   and `TaskSessionView` in `lib/services/task-session.ts`. Related:
   `Promise.all([...])` of multiple tRPC `utils.*.fetch()` calls trips
   TS2589 via tuple inference — fire the promises, then `await` each
   individually.
3. **Swap call-sites** — replace `authedFetch("/api/X")` with
   `trpc.X.useQuery` / `useMutation` / `utils.X.fetch`, one domain at a
   time. Every new `.input()` is a strict `z.object` — never
   `z.record`/`unknown`/`any`.
4. **Keep REST alive** — the `/api/*` routes stay until the domain is
   100% tRPC *and* soaked. This backward-compat window IS the rollback
   path.
5. **Decommission** — once soaked, delete the domain's now-dead REST
   routes. (Phase C — not started.)

## Milestones

- **M1** ✓ — journal slice merged (`f291eaef`).
- **M2** ✓ settings · **M3** ✓ actions · **M4** ✓ chat (chat-domain).
- **M5** — ultron: operator + task done (`3c9ce883`, `5627b8e4`);
  system-domain (B.6c) in flight.
- **M6** brain · **M7** system pages — pending.
- **M-done** — `hooks/use-authed-fetch.ts` deleted. The migration is
  not "done" until the helper is gone.

## Risk + rollback

- **Risk · payload mismatch** — a client payload that doesn't satisfy
  the server Zod schema → a runtime `ZodError` surfacing as a generic
  failure toast (the `/tasks` quick-add bug). **Mitigation:** protocol
  step 1 (contract test) + auditing every permissive
  `.input(z.record/unknown/any)` tRPC input. `task.create` and
  `task.createMission` STILL use permissive `z.record` inputs (the
  Phase-A "both since fixed" note was wrong) — their real validation is
  the stricter downstream `taskCreateSchema` / `missionCreateSchema`
  `.parse()`, and the contract tests pin call-site payloads against
  those. Tightening the 2 inputs to strict `z.object` is open cleanup.
- **Risk · TS2589** — see protocol step 2. The tRPC client type is near
  TypeScript's instantiation-depth ceiling; the firewall (explicit
  shallow procedure return types) is mandatory for every new procedure.
- **Rollback** — REST routes stay live through each slice's steps 1–4.
  Reverting a slice = repoint its call-sites back to `authedFetch`; the
  REST route was never removed until step 5.

## Honest progress metric

The debt lives in call-sites, not router count:

```
grep -rc "authedFetch" apps/statenour/{app,components,hooks,lib}
```

Latest sweep (2026-05-22, mid-B.6c): **148 files / 425 occurrences**
match — but ~20 are non-targets (this doc, contract tests, the
migration script, router comment-mentions) and ~15 are migrated files
carrying only a "migrated off authedFetch" comment. Real remaining
call-sites: **~100–110 files · ~40% of the migration done**. The
migration is complete when the grep returns 0 — `use-authed-fetch.ts`
has no importers and can be deleted.
