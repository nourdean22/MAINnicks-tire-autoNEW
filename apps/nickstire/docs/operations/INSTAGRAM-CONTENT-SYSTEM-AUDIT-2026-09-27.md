# Instagram + Content System Audit — 2026-09-27

Status: execution audit + truth repair.
Scope: Nick's Tire & Auto Instagram admin, content generation, Reel pipeline, publishing, analytics/learning, and public-profile presentation.

## Evidence / authority order

This audit did not treat docs or old session claims as truth. Evidence was reconciled in this order:

1. public Instagram profile and live media
2. production Railway configuration/logs
3. production database read-only probes
4. current `origin/main`
5. current service/router/schema wiring
6. tests/build
7. historical docs

Concurrent-work guard: implementation was isolated to a dedicated clone/branch and did not reset, stash, merge, or edit the NicksMax/NattyNour shared working copies.

## Public Instagram truth snapshot

Observed from Instagram's rendered public profile / SSR on 2026-09-27:

- account: `@nicks_tire_euclid`
- public follower count: 3,261
- public post count: 675
- verified profile
- primary link: `nickstire.org`
- additional financing links: Synchrony + Acima
- Highlights exposed publicly: `Testimonials`, `COUPONS!!!!`

The recent public grid is visually coherent around Nick's black/yellow identity, but the recent educational Reel cohort repeats a narrow production grammar: dark macro automotive imagery, shallow depth of field, yellow condensed captions, slow cinematic movement, and similar explanatory beats/CTAs.

## Recent live Reel outcomes

Production metric snapshots prove the Reel/Instagram metric ledger is collecting real outcomes. Selected September examples:

| Topic | Reach | Views | Skip rate | Notes |
| --- | ---: | ---: | ---: | --- |
| road-trip checklist | 328 | 397 | 36.8% | current-day snapshot |
| brake lines / salt | 298 | 340 | 53.8% | low interaction snapshot |
| serpentine squeal | 564 | 659 | 43.9% | saves/shares present |
| tread: legal vs safe | 1,766 | 1,910 | 32.7% | strongest sampled reach |
| plug vs patch | 356 | — | 70.5% | weak early retention |
| transmission fluid | 817 | — | 33.8% | strong relative retention |
| pothole damage | 287 | — | 57.1% | weak reach |
| struts | 352 | — | 82.9% | very high skip |

These are descriptive snapshots, not causal proof. Age, distribution, audience mix, and creative treatment differ.

## Content-quality finding: idea diversity != production diversity

A programmatic census of the 32 approved Reel packs added on 2026-09-25 found:

- 31 / 32 unique hooks
- 32 / 32 source briefs at 20 seconds
- 32 / 32 with five beats
- 32 / 32 with a visit-oriented ask
- 160 beat visuals but only 10 unique visual descriptions
- 7 unique motion descriptions
- 3 unique audio cues
- only 2 distinct loop descriptions
- 23 / 32 reuse the same four-hashtag set

The existing variety test verifies high-level motion-lens/archetype distribution; it did not measure raw beat grammar. That allowed varied labels to sit on highly repeated visual structure.

## Approved backlog truth

Approved Reel rotation currently contains 133 packs.

The old failure mode was "reviewed packs never become reachable." That was correctly repaired. The next bottleneck is editorial selection: "approved" must not mean "equally deserving of the next publication slot."

Target distinction:

- **Approved library** — safe, truthful, usable
- **Active slate** — strongest current candidates given timeliness, fatigue, available first-party footage, local demand, format balance, and measured prior outcomes

## Production correctness defect: Reel publication split-brain

### Before repair

The dedicated Reel publishing authority correctly stored:

`reel_jobs.status = posted/published` + durable `igPostId`

But the linked `social_content_inventory` row could remain:

`status = review_ready` + `publishedAt = null`

The universal metric sync intentionally reads only inventory rows marked `published`. Production therefore had real Reel metrics in the Instagram ledger while the universal content/learning layer still described the same content as unpublished.

This was the root cause of a live loop that could match inventory candidates yet update zero universal-inventory metric rows.

### Repair

The repair keeps Meta / `reel_jobs` authoritative and mirrors only **confirmed live** truth:

- ordinary Reel publish -> inventory mirror
- ambiguous publish reconciled as live -> inventory mirror
- recurring metric sync -> idempotent historical self-heal
- repair predicate requires terminal live Reel status **and** durable Instagram media ID
- mirror-write failure never converts a successful Meta publish into a retry, avoiding duplicate-post risk

Reel metric lookup now prefers exact identity:

`social_content_inventory.id = reel_jobs.briefId -> reel_jobs.igPostId -> instagram_analytics.postId`

Caption matching remains only as a legacy/static fallback.

## Content-run lineage

The schema describes `content_runs` as the durable parent of a "make something" request, but production had only one September content run and it remained in an unproven generating state while many Reels were created/published outside that lineage.

This branch wires Reel creation/deduplication and later Reel stages into the existing content-run model instead of inventing a second lineage model.

Target:

`content_run -> creative artifact -> inventory -> reel job -> approval -> publish -> IG media ID -> metrics`

## Static Instagram autopost resilience

Production logs/ledger showed multiple recent static-autopost generation failures, including incomplete/truncated JSON and "no caption" outputs.

The repair moves the vulnerable generation boundary toward schema-constrained structured output and retries malformed/truncated model output **before any external side effect**.

No extra publish retry is introduced.

## Creative QA

Rendered QA now recognizes two explicit blocking defect families that the sampled public output made important:

- `BEAT_SEMANTIC_MISMATCH`
- `MECHANICAL_MISREPRESENTATION`

Both route to generated-beat regeneration rather than being silently categorized as generic defects.

A deterministic production-grammar fingerprint was added for approved Reel briefs so structure repetition can be measured directly rather than inferred from archetype labels.

Fingerprint dimensions include:

- duration bucket
- beat count
- beat-purpose sequence
- visual families
- motion families
- audio families
- CTA family
- loop family

## Real-shop media

Instagram Studio evidence upload now registers usable first-party shop imagery in the existing media registry with `rightsStatus = real_shop`.

The media registry can list reusable real-shop images instead of requiring every future creative run to rediscover or re-upload the same evidence.

This supports a content strategy of real repair/shop evidence first, with AI used where it adds explanatory/creative value rather than pretending synthetic imagery is customer evidence.

## Operator UI / public bridge

Primary Instagram admin labels now express operator jobs:

- Today
- Create
- Queue
- Community
- Learn

Underlying route keys/state machines remain unchanged in this slice.

The homepage adds a native Nick's Instagram proof section using the existing Graph-synced public router instead of loading Instagram's third-party `embed.js`. It renders up to three recent posts, links to the canonical profile, and fails down to a direct profile link if the cache is unavailable.

## Shadow-judge calibration warning

The current shadow judge is useful but is **not calibrated enough to become a hard publishing gate**.

Production evidence includes Reels that the shadow judge rejected yet later produced comparatively strong measured reach/retention, and other rejected Reels that were weak. Treat the judge as a critic/hypothesis generator until enough outcome-linked calibration exists.

## Verification receipts

Changed-path verification completed in the isolated branch:

- focused Instagram/Reel correctness tests: 5 files / 42 tests passed
- adjacent integration slice: 18 files / 224 tests passed
- Nick's TypeScript typecheck: passed
- full Nick's Vitest suite: process exit 0
- production build: passed
  - Vite client: 3,334 modules transformed
  - server bundle: built
- `git diff --check`: clean

The full suite emitted expected test-path degradation/warning logs for unrelated mocked/unconfigured integrations; the process itself completed successfully.

## Remaining highest-leverage next wave

These are intentionally not disguised as already complete:

1. **Active-slate editor** — rank the 133 approved packs instead of rotating all acceptable packs as peers.
2. **Creative-entropy feedback** — surface production-grammar fatigue in Create/Queue without inventing a fake viral score.
3. **Outcome-linked structure hypotheses** — let measured patterns influence candidate structures through experiments/priors, not unqualified causality.
4. **Profile merchandising** — revisit pinned posts, Highlight structure/covers, bio conversion hierarchy, and Reel cover readability using actual performance evidence.
5. **Real-media retrieval UX** — expose the growing `real_shop` media registry in Create.
6. **Judge calibration** — compare shadow decisions with downstream skip/reach/save/share cohorts before any hard-gate promotion.
7. **Authenticated admin visual QA** — source/build behavior is verified; exact authenticated production spacing/responsive interaction still needs a real logged-in browser pass after deployment.

## Truth labels after this slice

- Meta/IG publishing plumbing: **LIVE + VERIFIED**
- Reel metric collection: **LIVE + VERIFIED**
- universal Reel inventory metric loop: **BROKEN in production snapshot; REPAIRED + TESTED in branch, pending deployment verification**
- Reel content-run lineage: **PARTIAL in production; WIRED + TESTED for new Reel flow in branch**
- static IG autopost: **LIVE BUT RECENTLY UNRELIABLE; resilience repair TESTED, pending deployment verification**
- content truth/claim QA: **BUILT + WIRED**
- production-grammar diversity guard: **MISSING in production; BUILT + TESTED substrate in branch**
- public Instagram homepage bridge: **BUILT + TESTED in branch, pending deployment**
- authenticated admin pixel-level QA: **UNVERIFIED**
