# tRPC Migration Roadmap

> **Track-1 modernization** (legacy-modernizer pass). The REST→tRPC
> strangler-fig migration. This doc is the map: domains, router status,
> slice order, the per-slice protocol. **"Done" =
> `hooks/use-authed-fetch.ts` is deleted** — you cannot half-delete a
> function, so that milestone forces the migration to actually finish.
>
> **Status (2026-05-22 · Phase B nearly complete):** 16 migration slices
> merged to `main`, all build-verified. **23 `authedFetch` call-sites
> remain** across 2 slices (straggler pages · hooks+lib finish). See
> **Phase B progress** below.

## Current state

- **Modern layer** — 9 typed tRPC routers in `lib/trpc/routers/`:
  `nick · operator · system · chat · browser · task · journal · brain ·
  ai`. React call-sites use the hooks client (`lib/trpc/client.ts`);
  non-React modules use `lib/trpc/vanilla-client.ts` (`createTRPCClient`).
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
| B.3a | system widgets            | `7b5c66f4` | ✓ merged · `components/system/*` widgets |
| B.4  | actions / task            | `bef2a860` | ✓ merged |
| B.5  | chat                      | `be2185bd` | ✓ merged · chat-domain calls |
| B.6a | ultron · operator-domain  | `3c9ce883` | ✓ merged |
| B.6b | ultron · task-domain      | `5627b8e4` | ✓ merged |
| B.6c | ultron · system-domain    | `f3af544b` | ✓ merged |
| B.7  | brain domain              | `68c3eb7e` | ✓ merged |
| B.7a | system pages · slice A    | `8e275dfe` | ✓ merged |
| B.7b | system pages · slice B    | `414c0e3a` | ✓ merged |
| B.8  | misc pages                | `6046ec50` | ✓ merged |
| B.9  | hooks · partial           | `09b6230a` | ✓ merged · partial — finished in B.14 |
| B.10 | cross-domain residuals    | `ac0d71d8` | ✓ merged · chat + ultron + brain stragglers |
| —    | vanilla tRPC client       | `9452aa84` | ✓ merged · infra · `createTRPCClient` for non-React call-sites |
| B.11 | actions surface (`components/actions/*`) | `fc218104` | ✓ merged · added the 9th router, `ai` |
| B.12 | scattered components      | `d7849454` | ✓ merged · 13 files · ultron/goals/chat/brain/ai/etc |
| B.13 | straggler pages           | —          | next (7 files) |
| B.14 | hooks + lib finish        | —          | pending (16 files) |

Remaining: **23 `authedFetch` call-sites** across B.13–B.14 — straggler
pages (7 · 4 `system/*` + knowledge + pins + voice) · hooks + non-React
`lib/` modules (16). Then **M-done**: delete `hooks/use-authed-fetch.ts`.

## Inventory — `authedFetch` call-sites by domain

| Domain | Status | Notes |
|---|---|---|
| journal    | ✓ done    | B.1 (proof slice) |
| settings   | ✓ done    | B.2 · folded into `system`/`operator`/`brain` |
| actions    | ✓ done    | B.4 (task-domain) + B.11 (`components/actions/*`) |
| chat       | ✓ done    | B.5 + B.10 residuals |
| ultron/HQ  | ✓ done    | B.6a/b/c + B.10 residuals |
| brain      | ✓ done    | B.7 + B.10 residuals |
| scattered components | ✓ done | B.12 (`d7849454`) |
| system     | ◐ partial | B.3a widgets + B.7a/b pages; 4 `system/*` stragglers → B.13 |
| misc pages | ◐ partial | B.8; knowledge / pins / voice stragglers → B.13 |
| hooks      | ◐ partial | B.9 partial; finished in B.14 (+ non-React `lib/` modules) |

Status reflects the `from "@/hooks/use-authed-fetch"` importer grep —
the reliable signal (loose `authedFetch` text mentions in migrated-file
comments are not call-sites).

## Slice order

Smallest-with-router-first, then scale. Executed order:

journal → settings → system widgets → actions/task → chat → ultron
(6a operator · 6b task · 6c system) → brain → system pages (A · B) →
misc pages → hooks (partial) → cross-domain residuals → actions surface
→ scattered components. **Tail:** straggler pages (B.13) → hooks + lib
finish (B.14) → delete the helper.

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

- **M1–M5** ✓ — journal, settings, actions, chat, ultron all merged.
- **M6** ✓ brain (`68c3eb7e`) · **M7** ✓ system pages (`8e275dfe`,
  `414c0e3a`) + misc pages (`6046ec50`).
- **M8** — the tail: straggler pages · hooks+lib finish (B.13–B.14 ·
  23 call-sites).
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

The debt lives in importers, not router count. The reliable signal is
the import statement, not loose `authedFetch` text mentions:

```
grep -rl 'from "@/hooks/use-authed-fetch"' apps/statenour/{app,components,hooks,lib}
```

Latest sweep (2026-05-22, after B.12): **23 files** still import the
helper (excluding `use-authed-fetch.ts` itself and the
`migrate-authed-fetch.ts` codemod script). Slices B.13–B.14 clear them.
The migration is complete when this returns 0 — `use-authed-fetch.ts`
has no importers and can be deleted.
