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

---

## Addendum, 2026-08-16: the four-tab IA and Reel-as-a-format, both gated

A second pasted plan proposed renaming the shell to **Compose / Queue / Inbox** and making Reel a
FORMAT of one Compose surface. Appended rather than edited in, per this file's own rule.

### REJECT — the Compose / Queue / Inbox rename

It is a **reversal of a reasoned decision**, not a completion of an unfinished one.

- Commit `388c0a1ff` (PR #1040, 2026-07-24) introduced `today/create/publish/community/insights` in
  ONE deliberate act whose message reads *"The operator has five jobs, not nine equal tabs."*
- The pre-rename labels were literally **HQ / Studio / Queue / Actions / Planning / Inbox / Learn /
  Control / Settings**. **"Compose" was never a label in this repo's history.**
- `docs/CURRENT-TRUTH.md` records **"Publish is the only queue"** — the word *queue* was
  deliberately freed and reassigned.
- `server/igShellNavigation.test.ts` pins the key array *and its order*, titled "in operator-job
  order". `LEGACY_TAB_KEYS` has never been edited since it was authored.

Renaming back would be the third naming of the same tabs and would strand that pin for no operator
gain. **The operator's actual complaint — fragmentation — needed none of it:** Today carried THREE
context-free doors to Create (two byte-identical buttons plus HQ's own "Enter Studio", HQ being
Today's tail section, not a screen). Fixing that is the whole of it.

### REJECT — Reel as a format of Compose

The input contracts are **disjoint, not a superset**:

| | Static | Reel |
|---|---|---|
| Per-beat visual / on-screen text / motion | — | 3 fields × 4–6 beats |
| Voiceover script | — | full audio track |
| Visual World | — | **paid** 3-image sub-loop, pick one before enqueue |
| Re-score interlock | server-side, automatic | **hard** — every edit nulls the score |
| Business objective | 1 of 7, required | **hardcoded `"DISCOVERY"`** — no control exists |

The server refuses reel through the static path at **five** distinct points, the primary being a zod
`.refine` on the `generate` input. Merging would flatten a paid loop into a dropdown.

**Also true, and separate:** the reel ENQUEUE input is `z.enum(["review","declined_work","manual"])`.
Widening resolution does NOT widen enqueue — adding `special_offer` to the client's resolvable list
turned a working lane (harmlessly collapsed to `"manual"`) into a hard enqueue failure.

### The finding worth more than either verdict

`buildDraftWorkspace` — which assembles Truth / Concepts / Execution / Preflight / compiled prompts
— had **ZERO callers**, its tRPC proc included, while `validateSourceGrounding` HARD-BLOCKED enqueue
on `sourceNotes` + `mechanicTruth` and all twelve truth-layer fields had zero occurrences in
`Studio.tsx`. The operator was approving a brief whose pass/fail inputs were unrenderable. It is pure,
so it now runs on the in-memory brief and recomputes as beats are edited.

### Still open from THIS file's P1, and still the highest-leverage quality change

`dailyReelPost.ts` still does not call `runConceptTournament`. The autonomous lane that posts every
day asks one model to ideate, score and pick in a single call, while the tournament built to replace
exactly that remains reachable only from the operator's Campaign Package. It is a cost decision
(5 LLM calls per brief vs 1) and therefore an operator decision, not an engineering one.

---

## CORRECTION 2026-08-16 — this file's own P1 was mis-scoped, and it hid a free fix

**Everything above about the tournament conflates two different judges at two different stages.**
The claim "the lane that actually posts every day self-scores" was true when written on 2026-08-05.
It went stale on **2026-08-13**, when NT-001 wired `judgeSingleConcept` into `dailyReelPost.ts`. The
2026-08-16 addendum immediately above repeated the claim without re-reading the service first — the
same failure this repo has already named once: *a doc asserting a value is a cache with no
invalidation.* Read the service.

The two stages, correctly separated:

| Stage | What runs today | Independent judgment | Cost to close |
|---|---|---|---|
| **Pre-generation** concept pick | `prepareCleanReelBrief` → `reelBriefGen` asks ONE model to ideate, score and pick | none | **5 LLM calls** (the tournament) |
| **Post-render** quality verdict | `judgeSingleConcept`, live since 2026-08-13, once per job, KV-deduped | yes — and already paid for | **zero** |

### The zero-cost half — SHIPPED 2026-08-16

The post-render verdict was **write-only**. `reel_shadow_judge_<jobId>` had two references in the
entire repo, both in the file that writes it, and the only read was `if (!alreadyJudged)` — a boolean
dedupe marker. The image lane could justify its 2026-08-07 gate flip because it persists verdicts to
**`ig_autopost_log`, a queryable log table**, and has a reader (`scripts/ig-dual-judge-readout.ts`).
The reel lane wrote the same measurement into **`shop_settings`, the settings KV** — same signal,
wrong substrate — and shipped no reader. It had been paying for a judgment it could not consult.

Now closed, with no migration (the KV key is `LIKE`-scannable) and no new LLM spend:

- `server/services/reelShadowReadout.ts` — pure summarizer. Imports `JUDGE_GATE_MIN_TOTAL` /
  `shadowJudgeGate` rather than re-hardcoding `60` a **third** time
  (`ig-dual-judge-readout.ts` already keeps a second copy).
- `scripts/reel-shadow-judge-readout.ts` — read-only reader. **Operator runs it**; this repo's only
  `DATABASE_URL` is production.
- The judge KV row now carries `briefId`, `topic` and `note`, so a verdict is identifiable. Nothing
  unread was added — the QC row was deliberately left alone for that reason.

**Three traps that make a naive version of this reader worse than none**, all encoded in tests:

1. **`shadowJudgeGate` fails CLOSED; the reel shadow lane fails OPEN.** Reusing the gate predicate
   directly counts an Ollama timeout as a quality blind spot and inflates the exact statistic an
   operator would flip a live publisher on. Unusable verdicts get a third bucket.
2. **The corpus is CONDITIONED, not a base rate.** The judge runs *after* `evaluateReelPublishGate`
   allows the reel, so every row already cleared rendered-QA. That is the right conditioning for a
   blind-spot rate and the wrong conditioning for "how good are our reels". The readout says so in
   its own header.
3. **A judge that throws writes NOTHING** (deliberately — the next tick retries). So judge failures
   never appear as errored rows; the corpus just gets *smaller*, and a small corpus with no blocks
   in it reads as an all-clear. Hence `coverage`: posted reels carrying no verdict at all.

The readout also reports **judge-vs-QC agreement**. If the free deterministic checklist already
flags what the LLM judge flags, the reel lane can gate at zero LLM cost — which would retire the
spend question below rather than answer it.

### The 5-call half — STILL OPEN, still the operator's

`prepareCleanReelBrief` genuinely has no independent concept selection, and wiring
`runConceptTournament` there is genuinely 5 calls where there is now 1. That decision is unchanged
and is not an engineering call. What changed is that it is **no longer the only lever**, and it is no
longer the cheapest one: run the readout first. A measured blind-spot rate tells you whether
pre-generation selection needs fixing at all, and the image lane set the precedent that this
decision is made on a number, not on an argument.

