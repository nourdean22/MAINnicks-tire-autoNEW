# Wave 57 · Config Strictness · Follow-up Plan

> **Status**: v10.0.529.106 · Wave 57 · partial-ship complete.
> **What landed**: 3 strict flags enabled in tsconfig.json
> (`noFallthroughCasesInSwitch` · `noImplicitReturns` ·
> `noImplicitOverride`). 5 surgical type-fixes shipped alongside.
> **What's pending**: 2 stricter flags (`noUncheckedIndexedAccess` +
> `exactOptionalPropertyTypes`) need a separate multi-day sub-plan.

## Why the bigger flags didn't ship

The 18-agent audit and consolidation plan flagged 2 more
type-safety flags as worth enabling:

| Flag | Error count (probe 2026-05-16) |
|---|---|
| `noUncheckedIndexedAccess` | **866 errors** |
| `exactOptionalPropertyTypes` | **347 errors** |

Combined: ~1,200 type errors fall out the moment either flag flips
on. That's not a single-PR fix · it's a multi-day systematic
migration. Shipping the flag without the fixes makes the entire
codebase fail `pnpm typecheck` and blocks every other PR until the
migration is complete.

## Migration sequence (when ready)

### `noUncheckedIndexedAccess` (866 errors)

This flag changes the type of `arr[i]` from `T` to `T | undefined`.
Most of the errors are honest gaps · the operator's been writing
defensively in most places already (`.find()` returns get `if (!x)`
guards) but indexed access often skips the check.

Migration order:
1. Write a probe script (`scripts/probe-strict-index-access.ts`)
   that runs `tsc --noEmit --noUncheckedIndexedAccess` and groups
   the errors by file + by class of access pattern
2. Fix the highest-density files first (typically tools.ts and
   lib/ai/* will have the most because of dynamic property
   lookups + bracket-access JSON parsing)
3. Most fixes are surgical: `const first = arr[0]!` (assert
   when invariant guarantees it) OR `const first = arr[0]; if
   (!first) return;` (guard when the invariant isn't proven)
4. Land in batches of ~50 errors per commit · the flag stays
   OFF until 0 errors remain
5. Final commit flips the flag in tsconfig.json + adds a CI gate
   that fails if anyone removes it

Estimated time: 2-3 focused days · ~10-15 commits.

### `exactOptionalPropertyTypes` (347 errors)

This flag distinguishes `{ x?: string }` from `{ x: string | undefined }`.
Tighter than the default. Most errors come from passing `undefined`
to a `?:` property when the type technically expects "absent" vs
"present-but-undefined".

Migration order:
1. Same probe approach
2. Most fixes are tightening prop types (the
   `Partial<X & { y: undefined }>` pattern) or using
   `delete obj.x` instead of `obj.x = undefined`
3. Land in batches · flag stays OFF until 0 errors remain

Estimated time: 1-2 focused days · ~5-10 commits.

## What's already strict

- `strict: true` (catches most things)
- `noImplicitAny: true`
- `noFallthroughCasesInSwitch: true` (new in W57)
- `noImplicitReturns: true` (new in W57)
- `noImplicitOverride: true` (new in W57)

That's already 5/7 of the stricter flags · the remaining 2 are
the "big migrations" that need their own runway.

## Decision · don't ship without the migration

Enabling either of the big-2 flags without fixing the 1,200 errors
first would:
1. Break every developer's `pnpm typecheck` immediately
2. Block every PR from passing the [1/15] typecheck gate
3. Make a future migration HARDER because errors accumulate fast

So the right play is: keep them OFF in main, run the migration
in a dedicated branch over 2-3 days when there's runway, and
flip the flag in the final commit of that sprint.

## What W57 did ship

The 3 safer strict flags caught 5 real bugs:

| File | Issue | Fix |
|---|---|---|
| `app/(mastery)/journal/page.tsx:188` | `useEffect` missing `return undefined` on one branch | added explicit `return undefined` |
| `hooks/chat/use-ambient-mode.ts:87` | same effect-cleanup-missing-return shape | same fix |
| `components/ui/error-boundary.tsx:57,63,75` | React class methods missing `override` | added `override` modifier |

Tiny but real · `noImplicitReturns` would have caught the journal
bug if a future refactor accidentally removed the cleanup function.
`noImplicitOverride` is React-class-component hygiene · prevents a
shadowing bug if the base class adds a new method by the same name.
