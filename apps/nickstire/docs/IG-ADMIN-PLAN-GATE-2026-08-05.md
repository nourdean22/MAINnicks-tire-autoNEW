# Instagram admin rebuild — plan gate, 2026-08-05

Gate of a pasted architecture plan, per `.claude/skills/plan-gate`. Verdict vocabulary from
`docs/UPSTREAMS.md`. **Every claim below is checked against code, not against the plan's prose.**

---

## The one-line verdict

The pasted plan is **right about the disease and wrong about the patient**. Its two structural
diagnoses hold up. Most of the ten "new" tables it proposes already exist under other names, and
its own build order buries the single highest-leverage fix — which is one column, not a rewrite.

---

## REFUTED — the plan proposes building what exists

The plan lists ten canonical tables as new. At least eight have incumbents:

| Proposed | Incumbent | Verdict |
|---|---|---|
| `social_content_projects` | `social_content_inventory` | NATIVE |
| `social_generation_runs` | `content_runs` | NATIVE |
| `social_approvals` | `social_content_approvals` | NATIVE |
| `social_assets` | `media_assets` | NATIVE |
| `social_metric_snapshots` | `ig_metric_snapshots` | NATIVE |
| `social_learning_records` | `social_reel_patterns` | PATTERN — narrower, reels only |
| — | `generation_reservations` | cost ledger the plan never mentions |
| — | `reel_jobs`, `social_drafts` | |

Renaming these into a fresh schema is a migration with no user-visible payoff. The gap is not the
table set; it is the **join between two of them** (below).

The plan also proposes a five-stage generation engine — brief compiler, concept tournament,
independent judge, direction development, layered quality gates — as if absent. The capability
ledger already carries `creative-genome-core`, `format-directors` ("genome to scored brief"),
`winner-genome-preservation`, `critic-truth-preservation`, `postqa-orchestrator`,
`creative-thesis-lock`. That is stages 1, 2, 3 and 5 with receipts.

---

## CONFIRMED — the plan's two real findings

### 1. Overlapping status systems — TRUE

Four `status` columns, four vocabularies, **no shared enum anywhere in `shared/`**:

```
social_content_inventory.status  varchar(32)
reel_jobs.status                 varchar(20)
scheduled_posts.status           varchar(16)
ig_autopost_log.status           varchar(16)
```

### 2. The lineage chain is not universal — TRUE, and worse than stated

- `reel_jobs.briefId` → inventory id. The reel lane **is** chained. ✅
- `igAutopost` contains **zero** references to `social_content_inventory`. ❌
- `ig_metric_snapshots.postId` is the **Instagram** post id, not a content id.

**So the break is not diffuse — it is one lane, and it is the lane that publishes most.**
`ig_autopost_log` shows real posts on 08-01 through 08-04 with live IG ids; `reel_jobs` shows
its last post on 08-03. The majority of published content never joins the spine, so
*"which content earned money"* is unanswerable for it — not because attribution is missing, but
because the join is.

---

## What the plan MISSES — and these change the build order

### A. Its own lifecycle enum cannot be stored

The proposed 14-value lifecycle includes `CHANGES_REQUESTED` — **17 characters**. Two of the four
status columns are `varchar(16)`. Under TiDB `STRICT_TRANS_TABLES` an over-length write is
**REJECTED and the row is LOST** (registered incident, `docs/ISSUE-REGISTRY.md`). Adopting this
lifecycle without widening the columns first would silently destroy publish records.

**Widths migrate before vocabulary. Non-negotiable.**

### B. Architecture is not what is stopping the account right now

Verified in production today:

- Reels stopped **2026-08-03** — Higgsfield `grace_daily_limit_reached` / `unlock_full_access_notice`.
  A plan-tier wall, not a code fault. 745 credits remain: a balance is not permission to generate.
- `content-reserve-replenish` had skipped **27 times** — `CONTENT_REPLENISH_ENABLED` unset.
  Reserve drained to **1** `ready` item.
- Autoposts still run but abort on the `viralShape` critic and on truncated LLM JSON.

No amount of schema normalisation posts a reel. **Unblock first, then restructure.**

### C. The plan adds surfaces without asking whether they tell the truth

Nine PRs this week (#1336–#1343, #1347) closed eleven sites where a failed read rendered as a
confident zero — "$0 RECOVERABLE", "0 · All clear", "All eligible customers have already been
contacted". A new Command Center built on the same habits inherits the same lie. Any new surface
must state *unknown* when a read fails, guarding on **data** (`isError || (!isLoading && !data)`),
not on `isError` alone — an offline PWA pauses the query and leaves both false.

---

## REJECT — over-built for a one-person shop

| Item | Why |
|---|---|
| Enterprise DM inbox, routing, SLA timers, assignment | Inbound volume is measured TINY. Build a DM **alert**, not a contact centre. |
| Competitor registry, share-of-voice, local sentiment | High maintenance, no decision changes at this volume. WATCH: revisit when >1 post/day sustained for a month. |
| Nine permission primitives | The operator holds every role. Keep the audit trail, skip the matrix. |
| Full table renaming to `social_*` | Migration cost with no operator-visible gain. |

---

## CORRECTIONS to my own first pass (18-agent audit, same day)

Recorded rather than quietly edited, because the first pass was published above.

1. **Surface consolidation is ~90% ALREADY DONE — stronger than I said.** The 14 files sit
   behind ONE route and ONE tabbed shell whose view keys are already
   `today / create / publish / community / insights / planning / patterns / actions / control /
   settings`. **Six of the plan's seven proposed destinations exist today**, and both named
   merges ("Today + HQ", "Queue + Board + ReelQueue") are already done in code. Adopting the
   plan's navigation verbatim would **silently drop four live secondary surfaces**. Verdict on
   the entire navigation section: NATIVE.

2. **A durable content id already exists — `content_runs.id`.** My first pass framed the lineage
   gap as "the chain breaks at igAutopost". That single fact stands (`igAutopost` has zero
   `social_content_inventory` references), but it is not the whole picture: the canonical id and
   the lifecycle-plus-health split the plan asks for are already shipped as `content_runs.stage`
   + `implementationState` + `operationalState`. The two real seams are narrower — **no
   per-version content history** (`social_content_inventory.version` is a CAS counter bumped in
   place, so an edit destroys the previous caption and brief), and a weak publish→metrics join.

3. **★ THE REAL QUALITY DEFECT, and it is not in the plan at all.** The concept tournament —
   four pitches, anonymized field, a judge told "you did NOT write any of these" — exists and
   works. But `runConceptTournament` is referenced in exactly three places: its definition, its
   tRPC procedure, and `CampaignPackageCard.tsx`. **The autonomous daily lane never calls it.**
   `dailyReelPost.ts:219` calls `prepareCleanReelBrief({topic, hookStyle})` with no thesis, and
   with no locked thesis `reelBriefGen.ts:574` instructs one model to *"ideate the concepts,
   score them, pick the single winner"* in a SINGLE call — the exact self-evaluation the
   tournament was built to replace.

   So there are two generation lanes with different epistemics: the operator's lane is
   tournament-governed, and the lane that actually posts every day self-scores. **If the goal is
   "consistently higher-quality content", this is the highest-leverage change in this document** —
   and the pasted plan proposes building a tournament that already exists rather than wiring the
   one that does.

4. **Secondary:** the tournament judge is independent in ROLE and INPUT but not in MODEL — neither
   the pitch calls nor the judge call passes a `model`, so both resolve to the same default.
   WATCH, with a concrete trigger: pin a distinct judge model when a second funded provider key
   exists (a single shared key going dry has already killed every LLM leg at once once before).

---

## The better build order — sequenced by decision latency, not tidiness

**P0 · Unblock (hours, mostly operator)**
1. Higgsfield plan upgrade — the only thing that restarts reels. *(operator)*
2. `CONTENT_REPLENISH_ENABLED=true` — **set 2026-08-05**, deploy SUCCESS, next cron window ~14:39 UTC proves it.
3. ✅ Shipped: a plan-tier wall now PAUSES the provider instead of retrying silently (#1370).

**P1 · Wire the tournament into the lane that actually posts — the quality fix**
4. `dailyReelPost.ts:219` must obtain a judged concept before generating, instead of asking one
   model to ideate-score-and-pick in a single call. Either call `runConceptTournament` or reuse a
   cached recent genome. **This is the single highest-leverage change for content quality**, and
   it is a wiring change to an engine that already exists and is already tested.
   *Cost note, and the reason it was skipped: the cron's cheapness is deliberate — one LLM call
   per rejected brief versus five for a tournament. Decide the budget explicitly rather than
   inheriting the bypass by accident.*

**P1b · One join, not one schema**
5. Make `igAutopost` write `social_content_inventory` — it has zero references today, so the
   highest-volume lane never joins the spine. One writer, no migration.
6. Backfill historical `ig_autopost_log` rows into inventory where an `igPostId` exists.

**P2 · One vocabulary, safely**
6. Widen `scheduled_posts.status` and `ig_autopost_log.status` to `varchar(32)` — **first**.
7. `shared/contentLifecycle.ts`: one lifecycle enum + a separate health enum. Adopt at the
   producers, not by rewriting consumers.

**P3 · Learn from the operator (the plan's best original idea)**
8. Record every approval, edit, rejection and override as training evidence. This is worth more
   than another generator and nothing today captures it.

**Not started until P1 lands.** The rule the plan proposes is right and worth keeping verbatim:
*no new capability until every existing one has a canonical owner.*

---

## Method note

The gate exists because this repo has a measured failure mode — `docs/UPSTREAMS.md` records nine
external audits in two days re-proposing what was already built. Memory records "~70% already
built" for this exact surface (NCSOS, 2026-07-21). This gate found the same ratio again.

The dangerous error when gating is the reverse of the usual one: marking something ALREADY BUILT
when it is a stub makes the operator skip real work. Every "already built" verdict here names a
reachable path, because this session found a service with twelve passing tests and zero importers.

---

## Addendum, same day: two P0 facts changed after this gate was written

Appended rather than edited in place. A dated gate is a record of what was believed at the time;
silently rewriting it destroys the only evidence of how the belief moved.

### 1. "Higgsfield plan upgrade is the only thing that restarts reels" is NO LONGER TRUE

P0 item 1 said the plan upgrade was the sole unblock. **#1376 shipped a second one.** A paid
provider returning a `PAUSE_PROVIDER` verdict now degrades the rest of the job to the free local
ffmpeg lane instead of going terminal, behind `REEL_FALLBACK_TO_TEMPLATE_STOCK`. That flag was set
`true` in production on 2026-08-05, so the next plan-tier wall produces a reel rather than silence.

The upgrade is now a **quality** decision, not an availability one.

### 2. The durable-storage blocker was STALE, and the gate inherited it

Planning around the free lane assumed prod had no object storage — the capability ledger's P2 on
`template-stock-reel-lane` says prod has no `S3_BUCKET`, so the lane "would REFUSE". **Checked
against Railway rather than against the ledger: it is fully wired.** Bucket
`nickstire-media-oq6yt1u22`, with `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` all present. `CLOUDFRONT_DOMAIN` is absent, which is correct — that is the
condition under which `usesProxiedReads()` serves permanent URLs through `{SITE_URL}/generated/{key}`.
Probe: `GET /generated/<nonexistent>` returns a clean `404 {"error":"media not found"}`, so the
request reaches the object lookup and credentials resolve.

**That ledger blocker needs rewriting.** It is the second time in this arc that a stale ledger line
drove a wrong plan — the method note above warns about the reverse error (calling a stub "built"),
but this is the same failure wearing the other mask: a blocker that outlived its cause.

### 3. A correction to the lifecycle-gap framing

Section C treats surfaces as the place truth breaks. There is a sharper instance: the reel
generation lane is **not** draft-first, contrary to how the pipeline runbook reads.
`processNextReelJob` genuinely stops at `assembled`, and the runbook shows an
`instagramAdmin.approveDraft` step — but that gate belongs to the ADMIN surface.
`server/cron/jobs/dailyReelPost.ts:271` sees `status === "assembled"` and calls `publishToSocial`
itself, with no approval. Any plan that assumes "generated content waits for review" is wrong for
the highest-volume autonomous lane.

**Operator decision 2026-08-05:** let the first free-lane reel publish unreviewed rather than hold
it. Recorded because the `template-stock-reel-lane` P2 ("keep it draft-first") explicitly advises
otherwise, and a deliberate override should not read as an oversight later.
