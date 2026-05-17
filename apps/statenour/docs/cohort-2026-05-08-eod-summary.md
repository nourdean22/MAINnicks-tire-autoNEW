# Cohort summary · 2026-05-08 EOD · v10.0.442 → v10.0.484

**Reconciliation pass · 43 versions across 2 days.**

This doc captures the full sprint that landed across 2026-05-07 (UTC PM)
and 2026-05-08. It pairs with the per-doc reconcile footers stamped
on every living doc in this folder (v10.0.485). If you're trying to
understand why a section of a doc says "Reconciled at v10.0.484," you're
in the right file for the context.

## Headline · what shipped

  · **31 versions** of forward work · v10.0.442-472 · sort/filter UX +
    skill recall floor + prompt audit + motion+a11y + ADR backfill +
    schema audit + v2 cutover Phase 0 tooling
  · **12 versions** of bug-fix wave · v10.0.473-484 · operator returned
    with broken capture / chat / image-gen, and we worked through
    schema-rollback + state-aura layout + classifier loosening +
    Venice flux-2-pro + composer fix + creativity tuning + UI trim
  · **1 reconciliation pass** · v10.0.485 (this push) · doc footers
    + cohort summary + MEMORY.md update

## Cohort A · forward work · v10.0.442-472

### v10.0.442-444 · sort + filter UX polish

| ver | substance |
|---|---|
| 442 | SortDropdown gains `defaultValue` + gold "customized" indicator + × reset · ux-audit + mobile-design driven |
| 443 | /knowledge category row migrated bare-Badge → FilterChipBar (44px iOS HIG) |
| 444 | audit-sort-filter.mjs widened to recognize `useState<Set<string>>` multi-select pattern |

### v10.0.445-448 · prompt audit

| ver | substance |
|---|---|
| 445 | Causation chain magnitudes removed (no more "-15%/hr" fabricated stats) + LIVE SCOREBOARD dedup |
| 446 | `cacheControl: ephemeral` wired on streamText (CRITICAL · 90% Anthropic discount unlocked) |
| 447 | Temporal sections compression + response-style v1↔v2 drift closed |
| 448 | Silent-failure breadcrumbs on judge-eval + adversarial-critic chain |

### v10.0.449, 452-457, 460, 466-469 · motion + a11y wave

| ver | substance |
|---|---|
| 449 | Motion+a11y top-3 · wisdom 44px chips + scaleX progress + 6 aria-labels |
| 452 | `--nour-text-secondary` re-aliased to fix WCAG AA contrast (3.28:1 → 6.4:1) |
| 453 | Universal `prefers-reduced-motion` rule (was 2 keyframes · now 59) |
| 455 | stagger-in stacking-context fix + dead `power-fill` keyframe removed + motion-perf audit script |
| 456 | AnimatedCounter render storm fixed (rAF setState → DOM ref) |
| 457 | FreshnessChip · N timers → 1 shared ticker via `useSyncExternalStore` |
| 460 | Brand-anchor cascade restructured · substring match → `[data-anchor]` opt-in |
| 466-469 | Box-shadow paint storm wave · 17 keyframes converted to opacity-on-pseudo · paint-class went 30 → 13 |

### v10.0.450, 454, 458 · ADR backfill (10 ADRs)

| ver | substance |
|---|---|
| 450 | ADRs 0001-0005 · provider chain · CoALA 3-lane · v1/v2 split · withGuardian · ephemeral cache |
| 454 | ADRs 0006-0007 · pgvector on Neon · skill semantic recall |
| 458 | ADRs 0008-0010 · glitch taxonomy · multi-agent fan-out · editorial-minimalist + StandardPage |

### v10.0.451, 461 · schema audit

| ver | substance |
|---|---|
| 451 | `scripts/schema-timestamp-audit.ts` shipped · audit doc identified 1 critical + 11 mutable candidates |
| 461 | False-positive caught · script widened to recognize `@default(now())` as creation-equiv · `StagedRecoveryItem` reclassified · migration canceled |

### v10.0.459, 463-465 · v2 prompt cutover Phase 0 tooling

| ver | substance |
|---|---|
| 459 | Cutover plan doc · 5 criteria + 4 phases + 3-level rollback |
| 463 | `scripts/prompt-shadow-summary.ts` · criteria 1-3 evaluator |
| 464 | `scripts/prompt-judge-comparator.ts` · criterion 4 paired-turn evaluator |
| 465 | `/system/prompt-parity` dashboard · operator visibility |

### v10.0.470-472 · ADR open-items wrap-up

| ver | substance |
|---|---|
| 470 | Probe coverage matrix snapshot · 5 of 8 categories complete · 3 remaining gaps documented |
| 471 | Skill recall correlation logging (ADR-0007 open item) |
| 472 | Per-lens cost telemetry (ADR-0009 open item) |

## Cohort B · bug-fix wave · v10.0.473-484

The operator returned with three broken surfaces and we worked through
twelve fixes in sequence.

| ver | symptom | root cause | fix |
|---|---|---|---|
| 473 | Journal capture broken · CAPTURE button + top quick-type both fail | v10.0.462's 8-model schema migration never reached production Neon (operator's local DATABASE_URL pointed at non-running localhost:5432 · `pnpm release:db` returned P1001) | Schema rolled back · migration parked at `prisma/migrations-pending/20260508001336_*` · `prisma/migrations-pending/README.md` documents the apply procedure |
| 474 | /chat layout · 2545px chat shell · empty scroll below | v10.0.469's `position: relative` on `.state-aura-*` made the wrapper a containing block for the `position: fixed` chat shell | Reverted state-aura's pseudo-element conversion · keyframes restored to direct box-shadow on parent (paint cost accepted in rare-fire states) |
| 475 | "help me come up with idea for creative picture" → image gen fired | Conjunction matcher tripped on `generate` + `picture` | Added `EARLY_IDEATION_NEG` regex to suppress image-gen interceptor when ideation framing detected |
| 476 | Error banner says "Venice rejected" but rawMsg is OpenAI billing | Banner provider tags hadn't been updated since v10.0.333 OpenAI switch | Banners now provider-agnostic · billing-cap + content-moderation get specific actionable messages |
| 477 | OpenAI billing cap hit · image gen failing | gpt-image-1 at $0.19-0.25/img blew the monthly cap | Switched chat path back to `generateVeniceImage` · default model = `flux-2-pro` ($0.04/img · modern Flux · strong text) |
| 478 | Mobile composer textarea crushed to 0px | 6 buttons + ModePersonaChip + send + textarea = 391px chrome on a 351px row | `hidden sm:flex` on audio + camera + ModePersonaChip on mobile · 4 visible buttons + 162px textarea |
| 479 | Image gen 400'd: "size rejected: Invalid enum value" | flux-2-pro accepts 256/512/1024/1536/1792 · our `inferAspectRatio` returned 1024x768 / 768x1024 (legacy) | Size enum updated · landscape → 1536x1024 · portrait → 1024x1536 · default → 1024x1024 |
| 480 | Image gen STILL failing with "OpenAI billing limit" rawMsg | Next.js dev-server module cache held the old `generateOpenAiImage` reference | Defense-in-depth · `lib/ai/openai-image.ts` `generateOpenAiImage` now delegates to `generateVeniceImage` internally · ANY caller (cached or fresh) hits Venice |
| 481 | Operator wanted creativity bumped | n/a (tuning) | 9 temperature settings raised · 6 intent temps + 3 task temps · sampling layer |
| 482 | Operator wanted Nick more suggestive | n/a (tuning) | New `BROADEN_AND_SUGGEST` operator-rule centralized in `operator-rules.ts` · instruction layer |
| 483 | "Come up with a scroll-stopping post" still fired image gen | v10.0.475 ideation regex required noun (idea/concept/...) within 50 chars · "Instagram post" wasn't in noun list | Loosened regex · trigger phrase alone wins · `\bcome\s+up\s+with\b` etc. anywhere in message → suppress |
| 484 | "NICK NOTICED · TAP TO WALK ME THROUGH" banner intrusive after every reply | `ProactiveInsightCard` mount in /chat fired on every assistant reply | Mount + import deleted from chat page · component file preserved for future surface mount |

## Lessons learned (shipped to glitch-taxonomy.md)

1. **Schema migrations need verification BEFORE pushing the code that
   depends on them.** v10.0.462's deploy ordering assumed `pnpm release:db`
   ran against production · in fact the operator's local DATABASE_URL
   pointed at a non-running localhost · the migration never reached
   Neon · production code expecting `updatedAt` columns 400'd every
   query against 8 tables until v10.0.473 rolled back. Future schema-
   touching pushes must pass `pnpm prisma migrate status` confirming
   the migration is APPLIED before merging the schema change.

2. **`position: relative` on a wrapper class breaks `position: fixed`
   children.** v10.0.469's box-shadow → opacity-on-pseudo conversion
   added `position: relative` to `.state-aura-*` for ::before
   anchoring · /chat nests a `position: fixed` shell inside that
   wrapper · the chat shell stretched to fill the wrapper's full
   2625px scroll height instead of the viewport. Pattern: grep for
   `position: fixed` consumers BEFORE flipping a parent class to
   any positioned context (`relative` · `absolute` · `sticky`).

3. **Next.js dev-server caches dynamic-import resolutions.** v10.0.477
   switched the `generateOpenAiImage` import alias to point at
   `generateVeniceImage` · fresh module loads got the new alias but
   already-cached module references still held the old function · 
   v10.0.480 defense-in-depth · the underlying `openai-image.ts`
   `generateOpenAiImage` itself delegates to Venice now · any caller
   gets Venice.

4. **Image-gen interceptor regex needs to handle ideation framing
   even without specific noun keywords.** v10.0.475's strict noun
   list (idea/concept/angle/...) within 50 chars missed
   "Come up with a scroll-stopping Instagram post" because "Instagram
   post" wasn't in the list. v10.0.483 loosened to trigger-phrase-
   alone (`come up with` / `brainstorm` / `help me think` anywhere
   in message) · LLM still has the `generateImage` tool available
   in chat mode · can call it inline when the operator explicitly
   asks.

5. **Mobile composer chrome must leave ≥ 120px for textarea.** 6
   buttons × 40px + chip + send + gaps + padding = 391px on a 351px
   row · textarea collapsed to 0px. Hide non-essential buttons on
   mobile · keep the canonical 4 (mic · attach · voice · send).

## Files this sprint added or rewrote

### New files

  · `docs/v2-prompt-cutover-plan.md` (v10.0.459)
  · `docs/probe-coverage-matrix-2026-05-08.md` (v10.0.470)
  · `docs/schema-timestamp-audit-2026-05-07.md` (v10.0.451 · revised
    v10.0.461)
  · `docs/adr/0001-0010-*.md` (v10.0.450 · 454 · 458)
  · `docs/cohort-2026-05-08-eod-summary.md` (this file · v10.0.485)
  · `scripts/schema-timestamp-audit.ts` (v10.0.451)
  · `scripts/motion-perf-audit.mjs` (v10.0.455)
  · `scripts/prompt-shadow-summary.ts` (v10.0.463)
  · `scripts/prompt-judge-comparator.ts` (v10.0.464)
  · `scripts/find-skills-for-sort-filter.ts` (v10.0.442)
  · `scripts/add-default-to-sort-dropdowns.mjs` (v10.0.442)
  · `prisma/migrations-pending/20260508001336_add_updated_at_to_8_mutable_models/`
    (v10.0.462 created · v10.0.473 parked · awaiting prod-DB-reachable
    operator session to apply)
  · `app/api/system/prompt-parity/route.ts` (v10.0.465)
  · `app/(mastery)/system/prompt-parity/page.tsx` (v10.0.465)

### Heavy edits

  · `lib/ai/system-prompt.ts` (v1 builder · v10.0.445 + 447 surgery)
  · `lib/ai/chat/interceptors.ts` (v10.0.475 · 476 · 477 · 480 · 483)
  · `lib/ai/venice-image.ts` (v10.0.477 · 479 · 481)
  · `lib/ai/openai-image.ts` (v10.0.480 · delegate)
  · `lib/ai/turn-intelligence.ts` (v10.0.481 · creativity bump)
  · `lib/ai/provider.ts` (v10.0.481 · creativity bump)
  · `lib/ai/prompt/policy/operator-rules.ts` (v10.0.482 ·
    BROADEN_AND_SUGGEST)
  · `app/(mastery)/chat/page.tsx` (v10.0.478 mobile composer ·
    v10.0.484 ProactiveInsightCard removed · v10.0.449 aria-labels)
  · `app/globals.css` (v10.0.452 contrast · 453 reduced-motion ·
    455 stagger-in · 460 brand-anchor · 466-469 + 474 box-shadow wave)
  · `prisma/schema.prisma` (v10.0.462 added 8 fields · v10.0.473
    rolled them back)

## Open items rolling forward

  · `prisma/migrations-pending/` migration awaiting prod DB access ·
    when applied, restore the 8 `updatedAt` fields per the
    `migrations-pending/README.md` procedure
  · v2 prompt cutover Phase 1 (10% canary) · Phase 0 tooling all
    shipped · awaiting operator green-light + 24-48h shadow telemetry
  · Box-shadow paint storm · 13 keyframes still paint-class
    (background-position shimmers + count-flash + a couple smaller
    ones) · lower-volume than the 17 already converted
  · Probe coverage matrix · 3 categories partial (contract drift ·
    template escape · race / ordering) · sketches in the matrix doc
  · OpenAI image gen restoration · `_generateOpenAiImageGptLegacy`
    in `lib/ai/openai-image.ts` is the dead-code'd original ·
    rename + raise the OpenAI billing cap to bring it back if ever
    wanted
