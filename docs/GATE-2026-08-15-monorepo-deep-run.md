# Deep run — 2026-08-15

One run report, per the operating brief. Findings are labelled with the evidence
that supports them, not with confidence adjectives:

**CODED** source exists · **TESTED** a test exercises it · **DEPLOYED** prod
received it · **LIVE VERIFIED** observed working in production this session ·
**UNKNOWN** not established · **BLOCKED** could not be established from here.

## Coverage — read this before trusting the rest

This run went deep on the truth layer, the crawler-visible surface, the SEO
pipeline's shape, agent-os / skill discovery, upstream dispositions and PR
hygiene. It did **not** audit: cron outcomes, revenue attribution end-to-end, AI
spend, statenour beyond its truth docs, `apps/worker`, or `packages/*`. Those are
unexamined here, not cleared.

Prod DB reads were **BLOCKED** by the session's permission classifier, twice, so
nothing below rests on a `cron_log` or table read. Everything production-grounded
came over HTTP against live endpoints.

---

## 1 · What was wrong that nobody knew

### 1.1 Two skills existed and could never load — LIVE VERIFIED

`apps/nickstire/.claude/skills/` is not a skill-discovery root for this harness.
`reel-operator` and `verifier-reel-pipeline`, both added in #1566 (2026-08-14),
were absent from this session's skill registry, and **no file in the repo
referenced either of them** — not `CLAUDE.md`, not the app adapter — so nothing
could surface the gap.

Verified rather than argued: 17 skills listed at session start, all from root
`.claude/skills/`; both reel skills appeared in the registry the instant they
were moved there.

The measured consequence is the content-PR mess the brief asked about:

| PR | created | output path invented |
|---|---|---|
| #1564 | 08-14 | `reel-brief-pack/2026-08-14/` |
| #1565 | 08-14 | `apps/nickstire/docs/content-packs/` |
| #1571 | 08-14 | `apps/nickstire/docs/content/reel-packs/` |
| #1580 | 08-14 | `apps/nickstire/docs/reel-production-pack-*.md` |
| #1583 | 08-15 | `docs/marketing/faceless-shorts/` |
| #1584 | 08-15 | `ad-factory/2026-08-15/faceless-reel-tire-safety/` |
| #1585 | 08-15 | `apps/nickstire/docs/REEL-PACK-*.md` |

Seven draft PRs in two days, seven conventions, **three of them the same topic**
(the penny test), and **zero pack files have ever merged to main**. Each session
started blind because the operator spec that would have grounded it could not be
read. Three of the seven were created *after* the skill landed.

This is "one source of truth has accidentally become several" in its purest
form — seven sources in 48 hours — and the cause was a directory path.

**Deeper point, which the fix does not solve:** a markdown pack is invisible to
`reel_jobs`, so the anti-repetition memory (21 days of `reel_jobs`, shipped in
#1558) *cannot see these packs*. That is why three penny-test packs were produced
without anything objecting. A reel pack that is not a pipeline row is not content —
it is a document about content. See §5.

### 1.2 Prerender proved identity, never payload — now closed

`prerender:semantic-check` validated title, description, canonical, H1, NAP and
JSON-LD across 9 routes. Every one of those passes on a page that has silently
lost the thing it exists for. Two live misses, both of which the old check waved
through:

- **2026-08-15** — the homepage five-star showcase rendered a **1-star** Google
  review, because Places returns the most *recent* reviews at any rating. Fixed
  in `a7240ee9b`; nothing would have caught the next one.
- **2026-08-11 → present, LIVE VERIFIED** — `/tire-prices-cleveland` prerenders
  with **zero per-size floor rows**. The live endpoint serves **9 sizes right
  now** (`source: "snapshot"`, written same-day). The committed snapshot was
  captured before the first `shop_settings.tirePriceFloors` write, so the
  proprietary data that is the entire point of an AEO page has been invisible to
  Googlebot for four days.

Recall that prod serves **two different documents**: Googlebot gets 153KB of
committed prerendered HTML, a browser gets the ~14KB SPA shell. The crawler copy
is the one that matters for acquisition, and it had no monitoring on its content.

Three payload rules now run off the committed HTML:

| route | rule | fatal |
|---|---|---|
| `/` | ≥3 review cards, none under 4 stars | yes |
| `/reviews` | ≥3 review-card attribution labels | yes |
| `/tire-prices-cleveland` | ≥1 per-size floor row | reported |

Both fatal rules are proven against real failure modes, not synthetic ones:
pointed at the pre-fix snapshot the homepage rule exits 1 with `1 review card(s)
under 4 stars (1)`; with the attribution labels stripped, `/reviews` exits 1 with
`only 0 review card(s) rendered`.

**Calibration matters here and the first draft got it wrong.** Counting the bare
string `Google Review` on /reviews yields 9 hits of which only 5 are cards — the
rest are two "Leave a Google Review →" CTAs, the "1,705+ Google Reviews" stat and
an aria-label, all of which render on an empty page. A threshold set against that
loose count carries a 4-hit static floor and passes with ONE real review. The
rules now match the exact per-card label `>Google Review</span>`.

### 1.3 truth_os.md carried two stale claims, one of them alarming

- "`reel-pipeline-assembly` expires **2026-08-16** → completion-authority CI goes
  red and stays red." **Refuted:** re-verified 2026-08-11, now expires
  **2026-09-10**. The live checker reports 4 stale capabilities, none
  load-bearing, exit 0. Agent memory carried the same stale line; both corrected.
- "`declinedWorkRecovery` **is live-sending** SMS against a field written 5 times
  ever." **Refuted:** false since 2026-08-08, when the operator set
  `FEATURE_DECLINED_RECOVERY=0` (read-back verified) and the matcher was repaired.

The second is the dangerous direction for a truth doc to rot: it described an
automation as actively texting customers off a bad list, a week after it was
paused. An agent reading it would either "fix" something already fixed, or alarm
the operator about sends that stopped.

**Coverage gap found while checking:** only **12 of 48** capabilities carry a
`verificationExpiresAt`. The other 36 cannot go stale because nothing dates them.
A green ledger is not full coverage.

---

## 2 · Assumptions the evidence refuted

| Assumption | Reality |
|---|---|
| The 2026-08-16 CI deadline is live and imminent | Spent on 2026-08-11. Two documents and one memory file still warned about it |
| `declinedWorkRecovery` is still texting customers | Paused 2026-08-08, read-back verified |
| The AEO price page publishes proprietary data | It does for browsers; for crawlers it has published none since it launched |
| #1566 shipped a working reel operator spec | It shipped a file no session could load |
| An SEO tool would improve search intelligence | The tooling is native and deep; the gap is a **data entitlement**, which no tool closes |

---

## 3 · Already better than the alternatives proposed

The SEO system is the clearest case. `gsc-data.ts` ships ranking-change,
CTR-opportunity, cannibalization and seasonality detection; `seoFixDrafts.ts`
turns the CTR signal into drafted title/meta edits for a human to apply;
`audit-prerender.mjs` tiers every route T1–T5 off real `search_performance`
impressions and clicks. "Searches where Nick's is close to winning" is
`findCtrOpportunities` + `detectRankingChanges` — already built, already the loop.

What it **structurally cannot know**, and no open-source app fixes: GSC reports
only our own property. Competitor rank on the same query, queries we never appear
for, and local-pack position are invisible by construction. That is a data
purchase, and Ahrefs + Supermetrics are already **DEAD (entitlement, not merit)**
in the register. Scraping SERPs to close it collides with the no-evasion rule this
repo already applied to GramAddict.

Likewise: `admin_proposals` + the fail-closed judge are a stronger publishing
architecture than a scheduler, and Turborepo/Inngest already answer what the
build/workflow proposals wanted.

---

## 4 · Upstream verdicts recorded (`docs/UPSTREAMS.md`)

| Upstream | Verdict |
|---|---|
| OpenSEO | **REJECT as an application** — and it does not close the real (data) gap |
| Postiz | **REJECT** — duplicates the publish lane *and* would publish around the judge + approval chain |
| Auto-Editor | **WATCH** — right tool, absent input; reopens on first real bay footage |
| Open SaaS | **REJECT** — boilerplate for greenfield; both apps are years past it |
| Ax / DSPy | **WATCH unchanged**, prerequisite re-checked — see below |

**The Ax row is the one worth re-reading.** Its blocker has always been "zero
labeled corpus". Two surfaces now collect exactly that and did not exist when the
row was written: `admin_proposals` stores a human APPROVE/REJECT on every
AI-originated write (#1541), and the judge stores a verdict per job. If either has
a few hundred adjudicated rows with the input preserved, the prerequisite is met
**for that one task**. Recorded as a countable check, not a claim — I could not
run it.

---

## 5 · The gap that survived investigation

**Reel packs terminate in draft PRs instead of entering the pipeline.**

The loop is broken in the middle, exactly as the brief predicted:

```
topic idea → production pack → draft PR → (nothing)
                                          ↑ never merges, never renders,
                                            never publishes, never attributed
```

Everything downstream already exists and is good: `reel_jobs`, the topic miner,
the curated Local Discovery library, anti-repetition over 21 days, the shadow
judge, the QC checklist, the free-lane fallback. The pack format is the only step
that leaves the system.

Moving the skill (§1.1) stops the *proliferation of paths*. It does not by itself
put packs into `reel_jobs` — that is a deliberate scope boundary, because the
correct entry point is `POST /api/admin/reel-canary {action:"start", topic}`,
which compiles a brief against prod, and calling it is an operator-authorized
action, not an agent's.

**Recommendation, not executed:** decide that a reel pack is a `reel_jobs` row or
a topic-library entry, never a repo file; then close the seven draft PRs. Closing
them is your call — I did not touch them.

---

## 6 · What changed

| Commit | Change |
|---|---|
| `d13da8808` | Two reel skills moved to the discoverable skills root, renamed to the app-prefixed convention, routed from `CLAUDE.md`. `agent:verify` green (106 parity checks, 9/9 canaries) |
| `ce4ac366d` | Prerender payload rules — assert content, not just identity. Proven against the real regression |
| `74801660a` | Two stale `truth_os.md` claims corrected against the systems they describe |
| `b60a04dcb` | Five upstream verdicts recorded |

Agent memory: the 2026-08-16 deadline corrected in both the index and the topic
file, with the coverage caveat added.

Earlier the same session: `a7240ee9b` (the 1-star review fix), merged as #1586 and
**LIVE VERIFIED** on prod — crawler HTML clean, deployed bundle carries the filter.

## 7 · Deliberately not done

- **No new infrastructure, dependencies, frameworks or services.** Nothing in this
  run adds a recurring cost. Net dependency change: zero.
- **Did not make the tire-price rule fatal.** It fails today, and the fix is a
  prerender refresh rather than a code change; a red shared gate would tax sibling
  sessions for no gain. It prints loudly every run, with the flip condition in the
  rule comment — the ledger's stale-vs-invalid split, reused rather than reinvented.
- **Did not close the seven draft PRs**, did not touch the customer portal, did not
  re-enable any flag, did not run the prerender workflow (it commits to `main`).
- **Did not build a competitor-SEO system.** The blocker is an entitlement.

## 8 · Blocked

- **Prod DB reads** — denied twice by the permission classifier. Every "does this
  cron produce anything?" question in the brief is unanswered because of it. If you
  want that half of the audit, it needs a permission rule.
- **Re-verifying `reel-pipeline-assembly`** requires a real prod IG render — an
  operator-authorized publish.

## 9 · What needs you

1. **Run the "Prerender refresh" workflow** (Actions → manual dispatch). One click.
   It restores the AEO page's proprietary data for crawlers and lets the third
   payload rule flip to fatal. Cheapest item here with direct search value.
2. **ROS-093 steps 3–4 — the real revenue decision.** The list finally means what
   it says: **53 estimates / $44,331** inside the 60-day window, against the
   $376,927 the dashboard used to imply. The automation is paused, so nothing is
   happening at all right now. Judge the loop against the corrected list, then
   decide on re-enabling `FEATURE_DECLINED_RECOVERY` and/or widening the window.
3. **Decide the reel-pack home** (§5), then close the seven draft PRs.
4. **Prod-DB read permission**, if you want the cron/attribution half audited.

## 10 · Highest-leverage next move

**ROS-093.** It is the only item here that is directly worth money, the evidence
bar was raised to meet it a week ago, and it is currently producing *nothing* —
the safest possible state, and also a zero-return one. Every other finding in this
run protects value; that one creates it.

Sequence: judge the loop against the corrected 53-row list → hand-review the first
batch → then decide the flag. The 15 already-paid customers found sitting in the
"declined" list are the reason to review before re-arming, not a reason to leave it
off forever.
