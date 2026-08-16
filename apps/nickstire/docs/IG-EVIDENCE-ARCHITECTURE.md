# Instagram Create — evidence architecture and read-honesty

**Status: LIVE** (PRs #1598, #1599, #1601, plus the audit-remediation PR that follows this doc).
Read this before touching Instagram source selection, the quality gate, or any admin read state.

This is a *current-truth* doc, not a history. Where it records a past defect it does so because the
defect is the reason the code has its present shape — delete a rule here and you re-open a named bug.

---

## 1 · The evidence chain, end to end

```
sourceOptions ──▶ operator taps a card ──▶ recordId
                                             │
                            resolveSourceProvenance(type, id)
                                             │
                    ┌────────────────────────┴────────────────────────┐
                    │  evidence: string   (prose, for the prompt)     │
                    │  facts: EvidenceFact[]  (structured, for gates) │
                    │  availability: resolved|verified_empty|unavailable
                    └────────────────────────┬────────────────────────┘
                                             │
              assessEvidence(facts, operatorText) ──▶ sufficiency + groundingScore
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
        prompt: labelled facts +                        source_grounding dimension
        evidenceDirective(...)                          (0–10, feeds the gate)
```

`facts` ride on the draft's `source` object so they survive the client round trip. **This is
load-bearing:** the router's `draftSchema` is a plain `z.object`, which strips unknown keys, so
before `facts` was added to `sourceSchema` every re-score path (evaluate / render / stage) re-graded
a fully grounded draft as "no concrete evidence" — and Render is the mandatory next step after
generation. The feature was destroyed by the next click.

### Which sources resolve a real record

| Source | Table | Notes |
|---|---|---|
| `review` | `review_replies` → `review_pipeline` | 5★ only. A detailed 4★ review cannot be used. |
| `declined_work` | **`alg_estimates`**, unmatched | The canonical lane — see §2. |
| `special_offer` | `specials` | Must be active **and** unexpired **and** started. |
| the other six | none | Operator-authored by design; cap at `thin`. |

`real_shop_photo` is **media** evidence, not a record: it is an upload
(`instagramStudio.uploadEvidencePhoto`, key prefix `ig-evidence/`). Do not add a record picker for it.

---

## 2 · `alg_estimates` is the declined-work lane. `work_order_items.declined` is not.

Nothing in this repo ever sets `work_order_items.declined = true`. The only writers are
`workOrderService.ts` (insert; the column defaults false) and `declinedWorkRecovery.ts` (sets it
**false** on recovery), and no migration updates it. A picker reading it was `WHERE false`.

Independent confirmation, from subsystems that never touched the picker: `nour-os-query.ts` builds
the declined-work contract from `alg_estimates` ("an unmatched quote is a walked/declined-work
recovery target"), and `customer_metrics.declinedValue/declinedCount` aggregate the same lane.

### ⚠️ The decline is INFERRED, never recorded

`alg_estimates` has **no `declined` column**. "Declined" is derived from `matched_invoice_id IS NULL`,
and the matcher requires same phone **and** amount within ±10% **and** an invoice inside a 30-day
window. An estimate the matcher merely failed to clear is indistinguishable from a customer refusal.

**Therefore:** publishing "this customer declined the brakes" from that row is fabrication. The
resolver states the recorded fact ("has no matching paid invoice") and marks the status fact
`basis: "inferred"`, which `assessEvidence` refuses to treat as sufficient on its own and
`evidenceDirective` orders the writer to qualify. **Do not "simplify" that wording.**

---

## 3 · Sufficiency is graded, not counted

`shared/evidenceSufficiency.ts`. Two orthogonal axes:

- **`role`** — what a fact can *do* for copy: `quote` · `anchor` · `temporal` · `magnitude` · `context`
- **`basis`** — how well it is *known*: `recorded` · `inferred` · `operator`

Splitting them is what lets an inferred ALG decline be usable as direction while remaining
unpublishable as fact — a state the previous single `evidenceStatus` boolean could not express.

**Sufficient** = one `recorded` quote ≥ 60 chars, **or** a recorded anchor plus a recorded
date/figure. Deliberately *not* a field count: one real customer sentence outranks three weak
metadata fields, because a verbatim quote cannot be produced by a model that lacks it.

### The score bands are constrained by the evaluator, not chosen freely

`scoreStatus` treats `< 5` as `block` and `< 7` as `warn`, and the evaluator's warning loop
historically collected only `status === "warn"`. A grounding score of **3 therefore emitted neither a
blocker nor a warning**, letting an ungrounded draft reach gate `pass` — weaker than the rule it
replaced. Hence:

| Sufficiency | Score | Why that number |
|---|---|---|
| `sufficient` | 10 | — |
| `thin` | 7 | At/above the warn threshold, so a legitimate operator brief does not warn forever; below the 8 that typing one character used to earn. |
| `insufficient` | **5** | Floor of the **warn** band. Lower is *quieter*, not louder. |

The loop now also collects `block`-status findings, so a finding can never be discarded for being
too severe. What *blocks* is still decided by `blockers` alone.

`hasConcreteToken` accepts a digit, a word-boundary ALL-CAPS acronym of **3+** letters (TPMS, ABS,
ECHECK — three not two, so "OK" is not specificity), or a non-leading capitalised word.

---

## 4 · Read honesty: four states, and the two traps

`client/src/lib/queryState.ts` — `readStatus` returns `loading | unavailable | empty | ready`.

**Trap 1 — the paused query.** react-query pauses when the browser reports offline
(`networkMode: 'online'`, the default): `isError` **and** `isLoading` are both false, `isPending` is
true, `data` is undefined. Guarding on `isError` alone falls through to the *empty* branch. On the
operator's phone this is the normal case, not an edge case.

**Trap 2 — the server that fails soft.** `readStatus` cannot see a procedure that catches its own
error and returns a truthy payload. `instagramStudio.diagnostics` returns
`{connected: false, counts: {}, …}` on a DB outage — so `!data` never fires. **Ask the payload
whether it connected**, not whether it exists. Same pattern: `getPerformanceReport` returns
`recommendationsError` rather than a fallback string dressed as advice.

**Gate the shell on data, not on status.** `readStatus` reports `loading` during a *background*
refetch, and with `refetchOnWindowFocus` + 10s staleness that fires on every return to the PWA.
Insights blocks only when `!analytics.data` — otherwise stale data keeps rendering while it
revalidates.

---

## 5 · Latency boundaries in `client/src/main.tsx`

Three numbers, each constrained by something measured:

- **`REQUEST_CEILING_MS = 300_000`** — must **exceed the server's own budget**.
  `generateReelBrief` makes two sequential `invokeLLM` calls at `timeoutMs: 120000` each (240s), and
  `postInstagramReel` budgets ~15s of container creation plus 30 × 5s of polling (~165s). A ceiling
  *below* those converts healthy slowness into false failure on non-idempotent, money-spending
  calls — the operator was told "failed" for a reel that went live.
- **`retry: 0`** — the ceiling is armed *inside* the fetch, so attempts multiply it. Any retry count
  makes the spinner bound a multiple of the ceiling, and query-core's `failed` transition leaves
  `fetchStatus === "fetching"`, which every loading branch reads as "still working". A failed read
  now renders an explicit unavailable state with a Retry control instead.
- **The timer is never cleared.** `fetch` settles at response *headers*; tRPC then reads the body
  with nothing watching. Clearing on settle left a stalled body unbounded.

`splitLink` routes `UNBATCHED_SLOW_PROCEDURES` (currently `instagramAdmin.getPerformanceReport`)
outside the batch. **Add any LLM-backed page-load query to that set** — `httpBatchLink` puts
concurrent queries in one HTTP request, so the slowest decides when every other card's data arrives.
The remaining Insights queries still share a batch *on purpose*: they are local table reads.

---

## 6 · Storage health has three states, and CloudFront is not one of them

`usesProxiedReads()` is `S3_ENDPOINT && !CLOUDFRONT_DOMAIN` — **CloudFront being absent is the
condition under which permanent URLs are served**, via `{SITE_URL}/generated/{key}`. Health surfaces
computing permanence as `!!CLOUDFRONT_DOMAIN` had it exactly inverted and reported "Ephemeral Only"
precisely when permanent proxied URLs were working.

| State | Condition | Report |
|---|---|---|
| `permanent` | `servesPermanentUrls()` | Name the delivery path (CDN vs app-proxied) |
| `expiring` | bucket set, no endpoint, no CDN → 24h presigned | Say the URLs expire; Meta stores them |
| `none` | no `S3_BUCKET` | Generation refuses to spend credits |

Plus `ephemeralStorageOverride()`: `assertDurableStorageForGeneration` has **two** passing branches —
a durable bucket **or** `REEL_ALLOW_EPHEMERAL_STORAGE=true`. Reading only the first raised a blocker
for a state in which generation was running fine. That is now a *warning* naming the real cost.

**Rule: a health surface must not keep its own copy of a decision the module already makes.** Read
`durableStorageConfigured()` / `servesPermanentUrls()` / `ephemeralStorageOverride()`.

---

## 7 · AI content does not publish itself

`saveGeneratedArticle` writes `status: "draft"` and generated notifications start `isActive: 0`.
Previously both went live the moment they were generated — an article onto nickstire.org/blog and
the sitemap, a notification onto the public ticker — while ContentManager displayed a Drafts counter
and an approve control that could never apply to them.

`getDynamicArticleBySlug` filters to **published**, matching its sibling listing. Without that the
draft gate was toothless: an unreviewed article was unlisted and out of the sitemap yet fully
readable at its guessable URL. The admin list is deliberately *unfiltered*, so review is not blind.

---

## 8 · Invariants a change here must not break

1. A record id **must not outlive its lane.** Clearing it on source switch is not cosmetic: a
   leftover review id now resolves an unrelated `alg_estimates` row as *verified*, turning a loud
   block into silent wrong-record grounding.
2. `RESOLVABLE_REEL_SOURCES` tracks the **enqueue** contract (`z.enum(["review","declined_work",
   "manual"])`), *not* the resolver's. Widening resolution does not widen enqueue.
3. Every resolver lane needs a **content guard**. A row that exists but carries no service text and
   no vehicle is not evidence; the ALG estimate sync writes `serviceDescription` as null.
4. `specials.discountType` is a **four**-value enum. Branching on `percent` vs everything-else
   printed a dollar figure for a free service.
5. Unknown is never zero, and "read and empty" is a claim. `loadCache()` returns null both when the
   file is absent and when reading throws — so the client can only report what it received.

---

## 9 · Testing rules learned the hard way

A source-text assertion can be **green precisely when the fix is gone**. In this arc, 7 of 46 scan
pins passed against unfixed code, two of them *vacuously* because the substring slice they searched
is empty when the guarded code is absent.

- **Call the code.** `assessEvidence`, `readStatus`, `deriveDeliveryIssues` and `buildDraftWorkspace`
  are pure — test them with constructed inputs, not `toContain`.
- **Use fake timers for the ceiling** (`server/requestCeiling.test.ts`), not a grep for `setTimeout`.
- **Scope negative assertions to code, not the file** — an explanatory comment naming the forbidden
  API will match a file-wide `not.toContain` and fail. This happened three times in one session.
- **Run BOTH roots.** `pnpm exec vitest run server` *and* `pnpm exec vitest run client/src`. The
  client root holds 56 files / 1,019 tests and was hiding two real failures while a server-only run
  reported green.
