# IG Carousel Intelligence Studio

Admin-only creative control room for planning, scoring, validating, and
preparing premium 5-slide educational Instagram carousels for
`@nicks_tire_euclid`. Route: `/admin/ig-studio` (owner login required).

## Why this exists

The existing IG/FB autoposter is binary: fire a generated post or do
everything by hand. There was no place where research depth, claim safety,
Cleveland relevance, repetition discipline, and boost-worthiness were
*enforced* before content goes anywhere. The Studio is that gate — an
intelligence layer in front of asset generation and publishing, not another
publish button.

## How it differs from the autoposter

| | Autoposter | Carousel Studio |
|---|---|---|
| Output | a posted/queued post | a scored, validated **brief** (copy + prompts + checklist) |
| Safety | template-level | per-claim detectors + boost gate + manual checklist |
| External calls | yes (IG/GBP paths) | **none — structurally disabled in V1** |
| Human role | approve/fire | creative director with receipts |

## Modes (V1 behavior)

- **Draft Only (default)** — plan/score/review brief, copy, prompts, caption. No image calls, no publish calls.
- **Asset Prep** — shows the Higgsfield prompt pack + exact output specs (4:5, 1080×1350, no baked-in text) with copy buttons. Does **not** call Higgsfield.
- **Publish Prep** — shows the caption block, slide order, and the publish checklist with manual gates. Does **not** publish; the publish button is disabled with the reason shown.

Future-mode placeholders (Generate Images · Publish to Instagram · Read
Insights) are visible but disabled: *"Disabled in this PR — no external social
or image-generation calls are made."*

## V1 limitations (deliberate)

- No LLM call in-app: the **Master Creative Prompt** is generated and copied
  into whatever model session the operator prefers.
- No persistence: briefs are the bundled SAMPLE seeds until DB-backed content
  memory lands. Samples are labelled and must be replaced before real use.
- Content memory is manual: paste recent topics/keywords/lanes from the
  content log (`nicks-tire-content-log.md` lives on the operator machine, not
  the deployed server — a local-Windows-path dependency would be brittle, so
  V1 uses paste-in fields and flags repeats).

## Using it with Higgsfield (manual)

1. Pick/produce a brief; get the Boost & Safety Gate green (≥70/75).
2. Switch to **Asset Prep**, copy the Higgsfield Prompt Pack.
3. Generate 5 images (4:5, 1080×1350). Reject any render with warped/baked
   text — headlines are overlaid manually per the typography plan.
4. Add overlays per each slide's `textOverlayPlan`.

## Using it with Instagram (manual)

1. Switch to **Publish Prep**; copy the caption block (hook → teaching lines →
   keyword CTA → business close → hashtags).
2. Walk the checklist: correct account, Facebook cross-post **OFF**, slide
   order 1→5, human read-through of every slide.
3. Post manually. Record the URL + log line in the content log (until
   `published_manual` storage lands).

## Boost scoring (how /75 is earned)

Sourced fact 10 · exact 5-slide structure 10 · one main idea 5 · claim safety
15 · no overdiagnosis 10 · Cleveland angle 10 · save/share reason 5 · valid
campaign keyword 5 · winning concept ≥57/60 5. Gate: **70**. Concepts score
six 0–10 dimensions (hook/truth/save/local/absurdity/fit), gate **57/60**.

## Claim safety rules (enforced by detectors)

Blocked: invented prices (only the approved used-tire line is allowed),
free-anything except "free check", guarantees/warranties, "best …", "everyone
uses us", fake urgency ("limited time", "book now before…"), "in stock",
"you need", exact wait times, "guaranteed same-day", "dangerous to drive",
hard diagnoses ("this means your X is bad", "definitely", "your X is broken"),
doom framing. Allowed soft language: "can point to", "may indicate", "worth
checking", "do not guess", "stop by and we'll take a look", "same-day service
when realistic".

## Hidden persuasion without manipulation

Implied local proof ("Cleveland drivers ask us this all the time", "We see
this after pothole hits") + clear teaching = authority without bragging and
demand without pressure. The reader should think "that sounds like my car" and
"this shop explains things clearly" — never feel pushed.

## Repetition discipline

One ALL-CAPS campaign keyword per post from the approved list. The Content
Memory panel flags topic / keyword / visual-lane repeats against pasted recent
history, and every brief records `avoidedForRepetition`.

## Future integration roadmap

1. **DB-backed content memory** — store briefs + published log; auto-populate
   the Avoid Today panel; enable "Save Draft" / "Mark Published Manually".
2. **Source-fetching research assistant** — pull AAA/NHTSA/Tire Rack passages
   with citations into `sourceNotes` (proof vs pain-point kept distinct).
3. **Higgsfield asset generation** — behind an explicit dry-run abstraction +
   operator approval; renders attach to `assetPaths`.
4. **Instagram draft/publish integration** — Meta Graph API as DRAFT-first,
   never auto-publish; checklist gates become hard preconditions.
5. **Insights feedback loop** — read post performance into the brief log.
6. **Boosted-performance learning** — rank territories/keywords by real boost
   results; feed scores back into concept scoring.

## Collision note (2026-06-10)

Built as all-new files plus two line-level additions (`App.tsx` route,
`shared/routes.ts` registry entry) chosen specifically because no open PR
(#46/#47/#48/#49) touches them. Admin-nav files (`pages/Admin.tsx`,
`pages/admin/shared/nav.tsx`) were deliberately left alone — a nav tile can be
added after PR #47 merges (one entry alongside the existing sections).
