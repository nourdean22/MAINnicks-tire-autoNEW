# tRPC Migration Roadmap

> **Track-1 modernization** (legacy-modernizer pass). The REST→tRPC
> strangler-fig migration. This doc is the map: domains, router status,
> slice order, the per-slice protocol. **"Done" =
> `hooks/use-authed-fetch.ts` is deleted** — you cannot half-delete a
> function, so that milestone forced the migration to actually finish.
>
> **Status (2026-05-22 · ✅ COMPLETE):** All 18 migration slices merged
> to `main`, all build-verified. `hooks/use-authed-fetch.ts` is
> **deleted** — zero importers. The REST→tRPC migration is done.

## Current state

- **Modern layer** — 9 typed tRPC routers in `lib/trpc/routers/`:
  `nick · operator · system · chat · browser · task · journal · brain ·
  ai`. React call-sites use the hooks client (`lib/trpc/client.ts`);
  non-React modules use `lib/trpc/vanilla-client.ts` (`createTRPCClient`).
- **Legacy layer — removed.** `hooks/use-authed-fetch.ts` is deleted;
  no client code calls `authedFetch`/`useAuthedFetch` anymore. The REST
  `/api/*` routes stay mounted — slimmed to call the same shared
  `lib/services/` functions the procedures use — as the rollback path
  until soaked; Phase C decommissions them.
- The `task` router is the reference implementation (most mature).

## Phase B progress

Slices ship one per commit · each gated (typecheck · `eslint .` · full
test suite) · build-verified by the pre-push `turbo build` hook.
  **VERIFIED 2026-08-23** -- this one is TRUE, and worth recording as such because most
  "verified at push time" claims in this repo are not. `lefthook.yml` `pre-push` runs exactly one
  command, `pnpm run build:affected`, which is `turbo run build --affected`.

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
| —    | command-palette prerender fix | `29e48302` | ✓ merged · root-layout scope → vanilla client |
| B.13 | straggler pages           | `7872709b` | ✓ merged · 7 pages · + `app/voice/layout.tsx` |
| B.14 | hooks + lib finish        | `2f172174` | ✓ merged · helper DELETED — migration done |

Remaining: **none.** All `authedFetch` call-sites are migrated and
`hooks/use-authed-fetch.ts` is deleted — **M-done achieved**. Next is
**Phase C**: decommission the now-unused REST `/api/*` routes after a
soak.

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
| system     | ✓ done    | B.3a widgets + B.7a/b pages + B.13 stragglers |
| misc pages | ✓ done    | B.8 + B.13 (knowledge / pins / voice) |
| hooks + lib | ✓ done   | B.9 + B.14 (12 hooks + 4 non-React `lib/` modules) |

Every domain is migrated; the `from "@/hooks/use-authed-fetch"`
importer grep returns 0.

## Slice order

Smallest-with-router-first, then scale. Executed order:

journal → settings → system widgets → actions/task → chat → ultron
(6a operator · 6b task · 6c system) → brain → system pages (A · B) →
misc pages → hooks (partial) → cross-domain residuals → actions surface
→ scattered components → straggler pages → hooks + lib finish → helper
deleted.

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
- **M6** ✓ brain · **M7** ✓ system pages + misc pages.
- **M8** ✓ — the tail: straggler pages (`7872709b`) + hooks/lib finish
  (`2f172174`).
- **M-done** ✅ — `hooks/use-authed-fetch.ts` DELETED (`2f172174`). The
  migration is done.

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

The debt lived in importers, not router count. The reliable signal was
the import statement, not loose `authedFetch` text mentions:

```
grep -rl 'from "@/hooks/use-authed-fetch"' apps/statenour/{app,components,hooks,lib}
```

Final sweep (2026-05-22, after B.14): the grep returns **0** —
`hooks/use-authed-fetch.ts` is deleted, along with its test and the
`migrate-authed-fetch.ts` codemod. **The migration is complete.** ✅

What remains is **Phase C**: the REST `/api/*` routes are still mounted
as the rollback path. Once soaked, the now-dead routes can be
decommissioned — separate track.
