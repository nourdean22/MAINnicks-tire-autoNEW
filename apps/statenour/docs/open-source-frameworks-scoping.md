# Open-source strategic-frameworks · extraction scoping

**Status:** DRAFT · awaiting operator approval · 2026-05-23 EVE
**Owner decision needed:** scope · license · naming · hosting.

## Why this exists

The user's standing instruction set (LeCun-lens consolidation pass)
included "open-source packaging of the strategic-frameworks registry"
as a Part-1 item. That's a multi-hour scope decision, not an
execution task — getting it wrong locks in choices we can't easily
back out of (license, name, what's in / out). This doc lays out the
options so the operator can approve / amend / reject in one read.

**Nothing in this doc has shipped.** If the operator approves the
recommendations below, a follow-up execution slice does the
extraction + publishing.

## What we'd be extracting

`apps/statenour/lib/ai/strategic-frameworks/` is currently:

- `index.ts` · registry + dispatch
- `types.ts` · `StrategicFramework` interface (id, name, oneLiner,
  triggers, antiTriggers, payload, etc.)
- `record-lens-fire.ts` · BrainMemory telemetry helper (project-coupled)
- `frameworks/*.ts` · 49 framework files · one per lens (elon-musk ·
  jtbd · porter's five forces · pareto · ooda-loop · jobs-to-be-done
  · etc.)

**52 files total · 49 framework lenses.**

Audit of project-coupling (today):

- Framework files: each `frameworks/<name>.ts` ONLY imports
  `../types` (verified · `grep` confirms). Each is a pure data file
  describing one lens with triggers, payload text, anti-patterns.
  **Zero project-local dependencies.**
- `types.ts`: pure interface · no imports. **Zero project-local
  dependencies.**
- `index.ts`: dispatches over the registry · no DB calls. **Could be
  pure, with the telemetry helper split off.**
- `record-lens-fire.ts`: BrainMemory persistence · project-coupled
  on Prisma. **Stays in statenour · not in the OSS bundle.**

This is a clean extraction. The framework registry was designed
this way (lens content separated from runtime mechanics) so it
COULD be lifted out without project-specific entanglement.

## Recommended OSS scope

**In** (52 files → ~50 OSS files):
- `types.ts` (rename to `index.d.ts` for an npm package)
- `frameworks/*.ts` (**49 files when this was scoped; 60 as of 2026-08-23** · the actual lens content · this
  is the valuable IP being shared)
  (reproduce: `git ls-tree -r --name-only origin/main | grep -cE 'lenses/src/frameworks/.*[.]ts$'`.
  The scope is "all of them", so the count is descriptive, not load-bearing -- dated
  rather than bumped, because it drifts every time a lens is added.)
- `index.ts` (dispatch · re-export of the registry)
- Plus added at publish time: `LICENSE` · `README.md` · `package.json`

**Out** (stays statenour-private):
- `record-lens-fire.ts` · DB telemetry · only useful inside an app
  with BrainMemory
- the lens-detector that maps user text → top-3 lenses (lives in
  `lib/ai/strategic-frameworks-detector.ts` if it exists, or
  inside the chat router · either way · it's the "how to pick a
  lens" runtime, separate from the "lens content")

## Recommended choices

| Choice | Recommendation | Why |
|---|---|---|
| **Name** | `@statenour/lenses` | Scopes under your org · signals provenance · short |
| **License** | MIT | Maximum reuse · matches the substrate-philosophy intent · no copyleft drag for downstream commercial use |
| **Hosting** | npm + GitHub repo `statenour/lenses` | Same repo · same release flow · most operators know npm |
| **First version** | 0.1.0 | Signal it's freshly extracted · API may shift |
| **Versioning** | Semver · breaking changes in MAJOR | Frameworks may be revised; runtime shape changes are MAJOR |
| **Bundle target** | ESM-only · TypeScript types included | The whole consumer story is "import the lens objects" · no CommonJS need |

## Open questions for operator

1. **Attribution.** Some lenses (Elon Musk, Warren Buffett, Steve
   Jobs, Charlie Munger) bear real-people names. Existing usage is
   "this lens is INSPIRED BY their thinking · not their words." The
   README needs to make that explicit; the operator should sign off
   on the phrasing.
2. **Selection cut.** All 49 lenses or a curated subset for v0.1.0?
   Some may have low fire-rate evidence and could be deferred. The
   `lens_fires` BrainMemory rows (in prod Neon) could answer this
   if we want the cut data-driven.
3. **Brand bleed.** Do we keep ANY statenour-specific anti-trigger
   regex in the OSS bundle? Most anti-triggers are generic ("not
   the rocket-launch SpaceX news") but a few may reference
   statenour-internal nouns. A pre-publish lint pass would catch
   them.
4. **Ongoing sync.** If we keep updating lenses in statenour, do we
   mirror to the OSS package automatically (cron job · CI) or do
   point releases (manual)? Automatic sync is cheaper to maintain
   but means every internal experiment leaks; manual releases keep
   private experimentation private.

## Recommended next step

If the operator approves this scope:

1. Branch · `oss-extract-lenses` · in the monorepo
2. Move the 49+2 in-scope files to `packages/lenses/` (using
   pnpm workspace · we already have one for `@nour/utils`)
3. Add `LICENSE` (MIT) · `README.md` (explains provenance + how to
   use) · `package.json` (scoped, ESM-only)
4. Statenour stops importing from `@/lib/ai/strategic-frameworks/`
   and starts importing from `@statenour/lenses` (internally · via
   the workspace · zero behavior change)
5. Publish to npm: `pnpm publish --access public`
6. Create GitHub repo · push the `packages/lenses/` subtree

**Estimated effort:** half a day, mostly because of the publish-
release ceremony (npm 2FA · GitHub repo setup · README writing).

## What this doc does NOT recommend

- **Don't open-source the detector.** Whoever built the detector
  (statenour) has tuned it on operator chat data. Releasing the
  detector tells competitors which patterns we route on · giving
  away the lenses content (already in the open across other
  sources) is a different ask than giving away the routing logic.
- **Don't open-source the BrainMemory telemetry helper.** It's
  Prisma-coupled and useless outside this stack.

## Decision

Operator approves / amends / rejects below. Until then this doc
sits in the repo as documentation, no code moves.
