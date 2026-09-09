# Reel validation cases — runtime coverage register (2026-09-08)

Source: *Nick's Tire — Design, Evidence and Validation Notes v2* (2026-09-08), 14 proposed
acceptance cases. That document's own **Deployment distinction** is the instruction this file
answers:

> "A prompt cannot implement database locks, budget reservations, account-wide caps, an API
> disclosure feature, or durable polling. Verify those mechanisms independently in the existing
> runtime. **If absent, record an implementation gap rather than inventing a successful safeguard.**"

So each case is mapped to the runtime mechanism that would have to enforce it, and to the test that
proves the mechanism fires. **Cases with no runtime mechanism are recorded as gaps, not as passes.**
A case that only a human or an agent-behaviour eval can judge is marked NOT-CODE — writing a unit
test for it would be theatre.

Verified by reading the tests, not by assuming from filenames.

| # | Case | Runtime mechanism | Covered by | Status |
|---|---|---|---|---|
| 1 | Evidence warning | `preflightEpisode` returns `allowed` with the finding in `warnings` when `requireClaimEvidence` is off | `shared/episodeContract.test.ts:111` · `server/episodeClaims.test.ts:78` | **COVERED** |
| 2 | Wording drift | `QUALIFIER_DROPPED` block code | `episodeClaims.test.ts` · `episodeContract.test.ts` | **COVERED** |
| 3 | Wrong scope (source is for another tire/vehicle class) | none — applicability is a judgement | — | **NOT-CODE** |
| 4 | Attractive mechanical error | `RENDERED_DEFECT_CODES` — mechanical codes are `block`, aesthetic are `warn`; any block forces repair | `renderedQa.test.ts` · `postQaOrchestrator.test.ts` · `repairRouter.test.ts` · `criticPanel.test.ts` | **COVERED** (corrected — first draft wrongly called this partial) |
| 5 | Generation timeout, provider charged | terminal → `needs_regen`, never silent stock; slot released | `reelStockFallbackDead.test.ts` · `reelReservationRelease.test.ts` | **COVERED** |
| 6 | Last daily slot, two workers | publish CAS `WHERE id=? AND status='assembled'` + `claimed !== 1` | `reelExactlyOncePublish.test.ts` (**added by this change**) | **GAP CLOSED** |
| 7 | Historical promotion / stale entitlement | none — balance is read live, entitlement is not modelled | — | **GAP** |
| 8 | Repeated creative family | `getRecentReelSignals` + `buildRepetitionChecks` (advisory) | `reelRepetitionHistory.test.ts` | **PARTIAL** — advisory by design |
| 9 | Missing optional metrics | per-slice availability; unknown ≠ zero | `adminTruth.test.ts` · `emptyIsNotUnknown.test.ts` | **COVERED** |
| 10 | Export changed after approval | `assetSha256` binding → `assetBytesChanged` / `assetDigestUnverifiable` | `reelPublishWindow.test.ts` | **COVERED** |
| 11 | Partial failure, one bad segment | per-beat repair routing | `repairRouter` suites | **PARTIAL** |
| 12 | Nonlocal viral outlier | none — no auto-promotion path exists to abuse | — | **NOT-CODE** |
| 13 | Container created, publish unconfirmed | `publish_ambiguous` as a third state, never `published`/`assembled` | `reelExactlyOncePublish.test.ts` (**added**) | **GAP CLOSED** |
| 14 | Malicious retrieved text | policy: fetched content is data | — | **NOT-CODE** |

## What this change adds

`server/reelExactlyOncePublish.test.ts` — 11 tests over the two controls that stood between the
autonomous cron and a **duplicate post on the owner's live Instagram account** and had no canary:

1. **The publish CAS** (`dailyReelPost.ts:1101`). The `UPDATE` is scoped to `status='assembled'`, and
   anything other than exactly one claimed row aborts before the Meta call.
2. **The unrecorded-publish rollback** (`:1121`). No attempt row → restore `assembled`, clear
   `publicationScheduledAt`, hold. Publishing unrecorded is refused.
3. **`publish_ambiguous`** (`:1157`). An exception after the irreversible call parks the job in its
   own state — not `published` (a lie) and not `assembled` (which invites a duplicating retry).

`dailyReelPost.test.ts` had seven tests and every one returned at the `REEL_AUTOPOST_ENABLED`
authority gate or exercised a pure helper; nothing reached the publish region.
`db-affected.test.ts` covers `affectedRowCount`, but a correct row-counter wired into an *unscoped*
`UPDATE` still double-publishes — the counter and the predicate are different failure surfaces.

**Every assertion is run against both the real region and a deliberately broken copy.** A check that
cannot fail is not a check, and a mis-bounded source slice passes vacuously — the defect
`reelPublishWindowWiring.test.ts` records having shipped twice.

## Open gaps — REVISED 2026-09-08 after reading the code

The first version of this section listed four gaps. **Two of them were wrong.** They were recorded
from assumption rather than from reading the implementation, which is the same failure this document
exists to prevent, pointed inward. Corrected below, with the evidence.

### NOT A GAP — aesthetic vs mechanical verdicts ARE separated (was listed as open)

`renderedQa.ts:35` defines `RENDERED_DEFECT_CODES`, a closed vocabulary **classed by severity**:

- **Mechanical / factual → `block`:** `MALFORMED_GEOMETRY` ("physically impossible automotive
  part"), `SUBJECT_CONTINUITY`, `DAMAGE_LOCATION_DRIFT`, `ENVIRONMENT_DRIFT`, `HUMAN_PRESENT`,
  `NARRATOR_EMBODIED`, `GENERATED_TEXT_ARTIFACT`
- **Aesthetic → `warn`:** `LIGHTING_DRIFT`, `PALETTE_DRIFT`, `WEAK_COMPOSITION`,
  `CAPTION_OBSTRUCTION`

*"any `block` finding => decision repair"* — there is no averaging, so a beautifully lit render with
wrong tread geometry is refused on the mechanical axis alone. That is exactly the validation notes'
"attractive mechanical error" case, already implemented, and referenced by four test files
(`renderedQa` · `postQaOrchestrator` · `repairRouter` · `criticPanel`). `qaState: "unavailable"`
additionally stops a non-evaluation from reading as an approval.

### NOT A GAP TO BUILD — music rights

There is **no music or audio-bed path in the pipeline at all**: zero references to `musicBed`,
`musicUrl`, `audioUrl` or `soundtrack` across `shared/`, `reelAssembly.ts` and `reelPipeline.ts`.
The packs state it explicitly — *"musicBed: none — deliberately omitted."* Voiceover exists
(`reelVoice`); a music bed does not.

Building a rights ledger now would be infrastructure for a feature that does not exist. The correct
form of this control is a **fail-closed guard at the point music would enter the assembly audio
graph**, added *with* that feature and not before. Recorded so it cannot be added silently.

### REAL — entitlement is not modelled (Case 7)

Balance is read live, but nothing represents *what the account is entitled to*, so a stale
promotion cannot be told from a live one in code. The cheap correct fix is not an entitlement model
but a **freshness assertion**: refuse a billable action on a balance read older than N minutes.
Mitigated today only by the operator-gated spend path.

### NOT APPLICABLE — alt text (Case: accessibility) — confirmed against Meta's docs 2026-09-08

No `alt_text` is sent on the publish container, and it cannot be: the Instagram media-container
reference states verbatim — *"Alternative text, up to 1000 character, for an image. Only supported
on a single image or image media in a carousel. **Reels and stories are not supported.**"*
(`developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media`).
Reel accessibility here is the burned-in caption track the pipeline already produces. Do not add
the parameter; the container would reject or ignore it. The same page confirms `is_ai_generated`
is accepted for REELS, which is what `resolveIsAiGenerated` sends.

### STANDING — `REEL_REQUIRE_CLAIM_EVIDENCE` is unset in production

`NO_CLAIMS`, `ENTAILMENT_MISSING` and `CLAIM_WITHOUT_EVIDENCE` are warnings. **Do not turn it on to
"fix" this**: `episodeContract.ts` records a measured 2026-08-01 dry run over 12 real briefs —
12/12 blocked, 11 on `CLAIM_WITHOUT_EVIDENCE` — because the generator cites sources the curated
registry does not contain. It is a registry-coverage gap; enforcing it today halts all reel
production.

### The lesson worth keeping

Of four recorded gaps, **one was already implemented, one should not be built, one was misframed,
and one is real.** A gap register decays exactly like any other claim, and an invented gap costs as
much as a missed one — it buys speculative work. Re-read the code before building against an entry
in this table.

## Standing caution from the source notes

> "These are proposed acceptance tests, not results of executed agent or production experiments."

Nothing here measures creative quality or business outcome. The tests added prove that named
safety mechanisms fire; they say nothing about whether a reel is worth watching.
