# tRPC Migration Roadmap

> **Phase A artifact** of the Track-1 modernization (legacy-modernizer
> pass, 2026-05-22). The REST→tRPC strangler-fig is ~56% by router
> count, but **~175 client files still call the legacy `authedFetch`
> pattern**. This doc is the map: domains, router status, slice order,
> the per-slice protocol. **"Done" = `hooks/use-authed-fetch.ts` is
> deleted** — you cannot half-delete a function, so that milestone
> forces the migration to actually finish.

## Current state

- **Modern layer** — 8 typed tRPC routers in `lib/trpc/routers/`:
  `nick · operator · system · chat · browser · task · journal · brain`.
- **Legacy layer** — ~175 client files call `authedFetch` /
  `useAuthedFetch` (`hooks/use-authed-fetch.ts`) to hit REST `/api/*`
  routes. The REST routes and the tRPC routers currently coexist.
- The `/tasks` domain was migrated in Phases PP–SS (the prior version
  scheme) — the `task` router is the reference implementation.
- `scripts/migrate-authed-fetch.ts` — a migration helper — already
  exists; use/extend it rather than hand-swapping every call-site.

## Inventory — `authedFetch` call-sites by domain

Counts are approximate (file-level, from a repo-wide grep). ~7 infra
files — the `useAuthedFetch` helper itself, `migrate-authed-fetch.ts`,
`trpc-provider.tsx`, the router files — are NOT call-sites and not
migration targets.

| Domain | ~files | tRPC router | Notes |
|---|---|---|---|
| journal    | 6  | `journal` ✓  | **proof slice** — smallest, router exists |
| settings   | 6  | —            | fold into `system`/`operator`, or a small new router |
| actions    | 18 | `task` ✓     | `/tasks` page already done; remaining action components |
| chat       | 20 | `chat` ✓     | call-site swaps |
| ultron/HQ  | 21 | `operator` ✓ | call-site swaps (verify `operator` router covers HQ scope) |
| brain      | 22 | `brain` ✓    | call-site swaps |
| system     | 48 | `system` ✓   | largest — do last |
| hooks      | 12 | mixed        | cross-cutting — migrate alongside their owning domain |
| misc pages | 12 | —            | financial / social / content / body / etc — fold per page |

## Slice order

Smallest-with-router-first — proves the pattern cheaply, then scales:

1. **journal** (6 · proof) → 2. **settings** (6) → 3. **actions** (18)
→ 4. **chat** (20) → 5. **ultron/HQ** (21) → 6. **brain** (22) →
7. **system** (48). Cross-cutting `hooks/` and misc pages migrate with
their owning domain.

## Per-slice protocol — the strangler-fig discipline

For each domain slice, in order:

1. **Test first.** Pin the domain's current behaviour with a contract
   test — the real client payloads validated against the server Zod
   schema. This is the guard against the typed-payload-mismatch class:
   see the `/tasks` quick-add bug (2026-05-21) — a permissive
   `z.record()` tRPC input let a thin payload through to a stricter
   downstream `.parse()`.
2. **Build / extend the router** — add the procedures the domain needs.
3. **Swap call-sites** — replace `authedFetch("/api/X")` with
   `trpc.X.useQuery` / `useMutation`, one domain at a time.
4. **Keep REST alive** — the `/api/*` routes stay until the domain is
   100% tRPC *and* soaked. This backward-compat window IS the rollback
   path.
5. **Decommission** — once soaked, delete the domain's now-dead REST
   routes.

## Milestones

- **M1** — journal slice merged · `authedFetch` count in
  `components/journal/` + `app/(mastery)/journal/` = 0.
- **M2–M7** — one per domain (settings → system), same zero-count
  metric per domain.
- **M-done** — `hooks/use-authed-fetch.ts` deleted. The migration is
  not "done" until the helper is gone.

## Risk + rollback

- **Risk** — a client payload that doesn't satisfy the server Zod
  schema → a runtime `ZodError` surfacing as a generic failure toast
  (the `/tasks` quick-add bug). **Mitigation:** protocol step 1
  (contract test) + auditing every permissive
  `.input(z.record/unknown/any)` tRPC input — there were exactly 2
  (`task.create`, `task.createMission`), both since fixed; re-audit as
  new routers are built.
- **Rollback** — REST routes stay live through each slice's steps 1–4.
  Reverting a slice = repoint its call-sites back to `authedFetch`; the
  REST route was never removed until step 5.

## Honest progress metric

Router count (29/50+) measures the *new* layer; it does not measure the
debt. The debt lives in call-sites:

```
grep -rc "authedFetch" apps/statenour/{app,components,hooks,lib}
```

Update the inventory table's per-domain counts as slices land. The
migration is complete when that grep returns 0.
