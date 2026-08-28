# Reel pipeline: does any of it ever publish? · 2026-08-28

**Verdict: it publishes, and it published today. The premise that this is a draft
graveyard is refuted.** What is orphaned is the *pack* lane, and the cause is one
hand-edited array.

Evidence is production rows (`scripts/probe-publish-history.ts`, read-only, host
`gateway01.us-east-1.prod.aws.tidbcloud.com`) plus a code-surface map. Anything
below that came from code alone is labelled as such.

## 1 · The publish lane is live

| Table | Lifetime | Last 30d (matches the Insights window) |
|---|---|---|
| `ig_autopost_log` | **157 posted** · 242 failed · 26 aborted · 20 dryrun | **37 posted** · 45 failed · 15 aborted |
| `reel_jobs` | 25 posted · 7 published · **30 rows carrying an `igPostId`** | 14 posted · 2 published · 10 assembled · 8 failed |
| `scheduled_posts` | 9 posted · 2 failed | — |
| `social_content_inventory` | 14 published · 30 failed · 10 review_ready | — |

Most recent successful autopost: **2026-08-28 12:08 ET** — the same day as this
audit. `instagram_analytics` holds 132 distinct posts and `ig_metric_snapshots`
750 rows across 93 posts, so the read-back loop is alive too.

**Success rate, with its base rate.** 37 posted of 97 attempts in the last 30
days = **38.1%**. The unfiltered lifetime figure is 157 of 445 = **35.3%**, so
the recent window is not a filtered artifact — this is the machine's normal
operating rate. Roughly six of every ten publish attempts fail.

**One cause dominates the failures.** Of 45 failures in 30 days, **23 (51%) are
`LLM returned no caption content`** — base rate 23 of all 97 attempts = **23.7%**.
Next: 5 timeouts, 4 × `403 this model requires a subscription`, and 4 JSON
truncations. This is a caption-generation problem, not a publishing problem, and
it is the single highest-yield fix in the estate: recovering those 23 would lift
the success rate from 38.1% to about 61.9% with no new content and no credits.

## 2 · The pack lane is orphaned — by a frozen 32-slug array

- **136 pack directories** in `docs/reel-packs/` (measured on this branch).
- The only pack→publish bridge is `APPROVED_REEL_PACK_SLUGS`, a hardcoded
  TypeScript array in `server/services/approvedReelPackRotation.ts` — **32
  entries, last one dated 2026-08-19**.
- **100 packs are dated after that last approved slug**, so they can never be
  selected. `approvedReelPackAt` returns `null` past index 31 and
  `dailyReelPost.ts` falls through to the miner.
- `packCoveredTopics()` reads the pack directory only as an *anti-collision
  avoid-list*; `reelPackRegistry.ts` says so explicitly, and gives the reason:
  treating packs as approved inventory "would convert a review queue into an
  autopost queue."

So the pipeline generates packs at a rate the approval bridge does not consume,
and the bridge is advanced by hand-editing a `.ts` file. The pack lane is not
broken; it is a **review queue with no reviewer**.

## 3 · This is a funnel problem, not a supply problem

The account published ~53 machine-originated items in the same 30 days that
produced **13,871 views · 137 interactions (0.99% of views) · 74 profile visits
(0.53% of views) · 1 website tap**. Supply is not the constraint at any point in
that chain. A proposal to spend generation credits producing *more* of this is
refuted by the account's own numbers, which is why no Higgsfield work was done
this pass.

**Higgsfield state (reported, not touched):** wired and credit-spend reachable.
`reelPipeline.ts` branches to `generateReelClipVideo` when the active provider is
`higgsfield`, and that runs from the `reel-pipeline` cron behind
`REEL_GENERATION_ENABLED`. Provider selection prefers Veo and falls back to
Higgsfield when Veo has no key. `instagramAdmin.ts` asserts the pipeline "generates
video with VEO, not Higgsfield" — that is a claim about live env values this audit
did not read; the Higgsfield branch demonstrably exists and is selectable. Left
exactly as found.

## 4 · The third state, resolved

The operator's instruction was: if the pipeline is dead, wire it or retire it —
do not leave a third state. It is not dead, so the instruction lands on the pack
lane instead, and there the honest options are two:

**A · Wire the bridge (needs operator approval — it arms a live send).**
Replace the hardcoded array with a reviewed-flag on each pack, so approving a
pack is a reviewable act rather than a code edit. This converts 100 dormant packs
into publishable inventory, which is precisely the change `reelPackRegistry.ts`
warns about — it is a customer-facing side effect and is not an agent-initiative
change.

**B · Retire pack generation until the bridge exists.** The generator is
currently producing inventory at a rate nothing consumes; each pack costs a PR
and a review slot that nobody spends. Stopping it costs nothing measurable —
there are already 100 unconsumed packs banked.

**Recommendation: B now, A when a reviewer exists.** Fixing the caption-failure
cause in §1 recovers 23 posts per 30 days from content that is *already
approved*, which is strictly more publishing than unlocking a backlog nobody
reviews. Do the cheap fix first, and only build the approval bridge when someone
is actually going to approve.

## 5 · What this audit did not determine

Live Railway env values (`REEL_PUBLISH_ENABLED`, `REEL_AUTOPOST_ENABLED`,
`IG_AUTOPOST_DRYRUN`, `REEL_VIDEO_PROVIDER`) and the DB flag
`legacy_autopost_live`. The prod row counts prove publishing *happens*, which is
the question that mattered; `scripts/probe-live-send-flags.mjs` settles the flag
values if a future session needs them. Note that `truth_os.md`'s flag table was
read live on 2026-08-16 and is 12 days stale — its own header says regenerate,
never retype.
