# NICK trust architecture -- adversarial follow-up to the 2026-09-10 audit

**Status:** engineering blueprint. Sections 1-3 shipped in this branch; everything after is ranked, costed and sequenced work.
**Method:** every claim below is grounded in `path:line` from this checkout, in a test in this branch, or in a source fetched and verified on 2026-09-10. Claims I could not ground are labelled INFERRED. The audit this responds to caught NICK inventing two YouTube channels; a response to it that invents repos would be self-refuting, so verification status is marked throughout.

---

## 0. Bottom line

The audit's diagnosis -- "it's a QA gate that doesn't gate, and a memory system that isn't being queried" -- is correct about the symptoms and **wrong about both mechanisms**, in ways that change what you build.

1. The gate did not "fail to enforce." **It was never given the inputs.** `runReplyGate()` has no fact-check parameter at all (`lib/ai/reply-gate.ts:79-84`). `unverifiedCount` is computed in `lib/services/chat/persist-assistant-turn.ts:405` and written straight to the panel payload; nothing reads it back. No threshold was mis-tuned -- three signals had no wire to the scorer.
2. The 525-word reply was **15 words** from being caught anyway. The critic's hard tier is `words > ceiling * 1.8` = 540 (`lib/ai/chat/output-guardian.ts:292`). At 525 it fell to the warn tier (`lengthScore = 60`), and only `<= 30` counts as a critical axis (`:322`). Composite: `100*.35 + 100*.25 + 100*.20 + 60*.20` = **92** -- the exact score in your panel. Two independent defects stacked; fixing either alone would have left the other.
3. "0 semantic memory hits" is **not** a pure-vector recall miss. That lane has **no min-score**, and its durable sub-lane returns up to 10 rows unconditionally (`lib/brain/memory-recall.ts:321-344`). Against a populated corpus a genuine zero is close to impossible. A `(0)` is overwhelmingly a **failed read** wearing the costume of an empty one.
4. Hybrid retrieval is not missing from NICK. **It is already written** -- `ts_rank(to_tsvector(...), websearch_to_tsquery(...))` at `lib/brain/contextual-recall.ts:487-495`, RRF-fused at `:854-866`. It just lives in a different lane, feeding a different prompt block, and the panel does not count it. You do not need a new search stack.
5. Four of the audit's five fixes are addressed to the **wrong layer**. It says to write them "as direct additions to whichever layer owns reply assembly" -- i.e. the prompt. But every failure it describes was *already detected and then ignored*. You cannot fix "the detector's output is unread" by adding instructions to the generator.

And the finding underneath all of them, in section 2.

---

## 1. What shipped in this branch

| Change | File | Evidence |
|---|---|---|
| Evidence-aware blocking gate: `runEvidenceGate()` with `verdict: pass\|repair\|block`, severity **floors** (a fact-check failure can no longer be 0), length-ratio signal, receipt signals | `lib/ai/reply-gate.ts` | `tests/ai/evidence-gate.test.ts` -- 23 tests |
| Named-source receipt checker (the "Stoic Strategy" class): proper nouns presented as findable resources must be backed by a tool result from *this turn* | `lib/ai/chat/named-source-claims.ts` (new) | same suite |
| `[confirmed]`-style tags stripped when no receipt backs them | `lib/ai/chat/named-source-claims.ts` | same suite |
| Recall three-state provenance `OK\|ZERO\|ERROR\|UNMEASURED` + `describeRecallState()` | `lib/brain/memory-recall.ts`, `lib/services/chat/brain-context.ts` | `tests/ai/recall-provenance.test.ts` -- 7 tests |
| Verifier banner stripped at the render boundary | `lib/services/chat-conversation-read.ts:232` | `tests/ai/verifier-leak.test.ts` -- 7 tests |
| History note de-first-personed so the model cannot parrot it | `lib/ai/chat/sanitize-history.ts:85` | same suite |

**37 new tests, all passing.** Every blocking rule is asserted in both directions (violation fires **and** a clean control still passes), per `AGENTS.md` "Ship the canary, not just the control." The audit replay carries a **positive control** asserting the *old* shape-only gate still scores that exact turn `0` -- without it, a new function trivially "passes" a regression it was never subject to.

---

## 2. What the previous audit missed

### 2.1 The disease, not the symptom: NICK's build loop terminates at "instrumented", never at "enforcing"

The audit found one dark wire and called it a broken gate. There are **at least eleven**, all the same shape -- capability designed, coded, commented, sometimes tested, then left unreachable:

| # | Dark wire | Evidence |
|---|---|---|
| 1 | `stripVerifierBanner()` -- written 2026-07-11 with a docstring saying "the warning chip already conveys the diagnostic", **zero production callers** for two months | `lib/ai/chat/fabrication-rewriter.ts:135` |
| 2 | `trustTier` column (`OPERATOR \| SYSTEM_DERIVED \| AGENT_INFERRED \| EXTERNAL_CONTENT`) -- **zero readers, zero writers** in TypeScript | `prisma/schema.prisma:1756` |
| 3 | `queryPlan.exactTerms` -- computed, `console.info`'d, never queried | `lib/services/chat/brain-context.ts:555` |
| 4 | `posture` / `depth` -- `setPosture`/`setDepth` have **zero callers** since the composer chips were removed; transport ships only non-`"auto"` values, so the server's `"spar"`/`"execute"`/`"counsel"` branches are unreachable code | `features/chat-v2/stores/chat-ui-store.ts:95`, `hooks/use-chat-stream.ts:59`, `finalize-system-prompt.ts:369` |
| 5 | `nick-prime-context.ts` -- self-documented "NO consumers wired" | `lib/ai/context/nick-prime-context.ts:15` |
| 6 | `checkKnownTruth` -- "was pure dead code (only tests/evals called it)" | `persist-assistant-turn.ts:406` |
| 7 | The only pre-flush buffered path is flag-dark and self-suppresses on action intents | `app/api/ai/chat/alternate-paths.ts:111,162` |
| 8-11 | `NICK_COVE`, `NICK_VERIFIED_REGEN`, `NICK_DEPTH_UNCAP`, `NICK_KNOWN_TRUTH_BANNER` -- all default-off. `NICK_VERIFIED_REGEN`'s own flag description reads: *"shouldRegen is computed + logged but never acted on; reply ships single-pass."* | `lib/feature-flags.ts:236-275` |

Two of these are worse than dark -- they are **actively misleading**:

- `lib/brain/memory-recall.ts:7` advertises **"Hybrid search (FTS + KNN)"**. The file contains two SQL statements and both are `ORDER BY embedding <=> $1::vector`. There is no FTS. Anyone reading the header concludes hybrid retrieval is solved.
- `lib/brain/memory-recall.ts:65-71` records, in its own comment, that the post-KNN category filter measured **`hit@5 = 0/28`** on the labelled corpus. The filter is still there (`:425`).

**This is a process defect, and no prompt patch reaches it.** The audit's "ship this week" advice ("a system-prompt-and-gate-threshold edit... you could have it live in an afternoon") would have added a twelfth dark wire. The correct fix is a rule: **no detector merges without a consumer**, enforced by the repo's existing `assert-the-consumer` skill and a CI check. See section 8.

### 2.2 A blocking gate is architecturally impossible where the audit asked for it

Fix 1 says "on block: regenerate once." Every post-generation pass runs inside `streamText`'s `onFinish` (`lib/services/chat/persist-assistant-turn.ts`, wired at `build-stream-config.ts:384`). The first token is already on the wire at `build-stream-config.ts:340`. `onFinish` cannot fire until the last token has been delivered. **No edit to `reply-gate.ts` can turn a log into a block on the default path** -- the file concedes this itself at `persist-assistant-turn.ts:107-110`.

So the gate this branch ships is *correct but not yet load-bearing*: it returns `block`, and on the streaming path there is nothing to block. The architectural fix is **risk-classified buffering** (section 5), not a stronger scorer. That distinction is the difference between a week of work and an afternoon of theatre.

### 2.3 The retrieval bug is a fail-soft embedding call, not an embedding-space problem

`embedUserMessage()` returns `[]` on a 12s timeout (`lib/ai/tool-embeddings.ts:393-401`). The hybrid lane is hard-gated on `userEmbedding.length > 0` (`brain-context.ts:319`) -- and, uniquely among the four recall lanes, **it does not accept `|| forceRecall`** (compare `:291`, `:301`, `:316`). One slow embedding call silently zeroes the only lane the panel counts. That is your turn-to-turn inconsistency, exactly.

Then the failure is laundered into an empty result at **five** independent layers: `memory-recall.ts:276`, `:348`, `:383`; `brain-context.ts:138-142` (`Promise.race(...).catch(() => fallback)` -- a rejection and a timeout are indistinguishable); `brain-context.ts:589`; and finally `chat-island.tsx:234` swallows the panel's own refetch error with a bare `catch {}`.

Adding BM25 would not have fixed the observed `(0)`. It is a genuinely good idea for a *different* problem (paraphrase recall), and it is section 4's second item -- but the audit prescribed it as the fix for this symptom and it is not.

### 2.4 Query embeddings are generated with the wrong Cohere input type

`lib/ai/provider.ts:1590` hardcodes `input_type: "search_document"` for **every** `getEmbedding()` call, including the query side of `memory-recall.ts:276`. Cohere's embed models are asymmetric: queries want `search_query`. This systematically weakens exactly the paraphrase matches ("the taper plan" vs the original brain-dump wording) the audit flagged. CONFIRMED as code; impact INFERRED.

**Do not flip it blind.** Every downstream threshold -- `0.42` min similarity (`chat-recall.ts:64`), `0.12` rerank drop (`brain-context.ts:500`), `confidence >= 0.3` -- was tuned against the current symmetric behaviour. Changing the query side shifts the whole score distribution. This is Experiment E1 (section 11), with an offline harness, not a deploy.

### 2.5 The audit's own comparison set is a live instance of the bug it reports

The audit is right that "Adept / Lex / Replika / Mem X" is Exhibit A. It then cites `mem0.ai/blog/state-of-ai-agent-memory-2026` with specific deltas (+29.6 / +23.1 pts on LoCoMo/LongMemEval) as the backbone of its memory-architecture section. **Vendor benchmark numbers on a vendor's own blog are marketing until independently replicated**, and LoCoMo in particular has documented saturation and construct-validity criticism. Adopt mem0's *architectural idea* (multi-signal fusion + actor attribution -- both good, both already partly present here) and discard its *numbers*. Treating those as evidence is the same error class as `[confirmed]` applied as a vibe.

### 2.6 The `[confirmed]` tag was never the problem; unearned authority is

The audit's Fix 2 is right that tags must come from the tool log. It misses that **the same rule binds every other authority signal NICK emits**: a cited date ("you wrote about this on 9/1"), a specific dose figure, a named number. The audit treats the date-citation case as a footnote ("either reading is bad"), but it is the *same defect* -- a first-person assertion of retrieval that no retrieval receipt supports. The generalised rule is in section 5.3: **no reply may assert provenance that the turn's receipt ledger cannot substantiate**, whatever syntax it wears.

---

## 3. The 10 highest-leverage upgrades

Ranked by (trust lift x quality lift) / (effort x operational risk). "R" = reversibility.

| # | Upgrade | Trust | Quality | Effort | Latency | Risk | R | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | **Wire every detector to a consumer** (evidence gate) | ***** | *** | S | 0 | Low | High | **shipped** |
| 2 | **Three-state recall provenance** -- a failed read never renders as an empty memory | ***** | ** | S | 0 | Low | High | **shipped** |
| 3 | **Named-source receipts** -- no proper-noun resource without a this-turn tool result | ***** | **** | S | 0 | Med (FP) | High | **shipped** |
| 4 | **Delete the inline verifier voice** | **** | ** | S | 0 | Low | High | **shipped** |
| 5 | **Risk-classified buffering** -- high-risk turns go through `generateText`, gate, then fake-stream; low-risk turns stream as today | ***** | *** | M | +1-3s on ~15% of turns | Med | High | design in 5.2 |
| 6 | **Fuse the lexical lane you already have** into the counted lane (`contextual-recall.ts:487` -> `memory-recall`) | *** | ***** | M | +30-60ms | Low | High | design in 4.1 |
| 7 | **Activate `trustTier`** -- write it on ingest, filter and display on recall | **** | *** | M | ~0 | Low | Med | design in 6.1 |
| 8 | **Register classifier that actually reaches the prompt** (health/technical/meta/coaching), replacing the dead posture path | *** | **** | S-M | 0 | Low | High | design in 5.4 |
| 9 | **Commitment extraction -> Missions**, so "starting tomorrow" becomes a row, not prose | **** | *** | M | 0 | Med (side-effect) | Med | design in 6.3 |
| 10 | **Transcript-derived regression suite + a consumer-coverage CI gate** so #1-#9 cannot silently un-wire | ***** | *** | M | 0 | Low | High | design in 8 |

Upgrades 1-4 are done. **5 and 6 are the critical path**; 7-10 compound.

---

## 4. Retrieval: use what is already there

### 4.1 The fusion fix (upgrade 6)

You have three recall lanes. Only one feeds the panel, and it is the only one without a lexical path.

| Lane | Dense | Lexical | Feeds the counted panel | Marked `critical` in the prompt |
|---|---|---|---|---|
| `memory-recall.recallMemoriesForQuery` | yes | **no** | **yes** | **no** (`brain-context.ts:463`) |
| `contextual-recall.getContextualMemories` | yes | **yes** (`:487-495`) | no | yes |
| `chat-recall.buildChatRecallBlock` | yes | no | no | -- |

Three defects follow from that table, and none needs a new dependency:

1. **Add the lexical lane to `memory-recall`.** Lift the `websearch_to_tsquery` + `ts_rank` SQL from `contextual-recall.ts:487-495` into a third RRF input alongside the two KNN lanes already fused at `memory-recall.ts:237-247`. Also feed `queryPlan.exactTerms` (currently logged and discarded) as an exact-match lane -- that is the path by which "the taper plan" finds a memory phrased differently.
2. **Mark Hybrid Recall `critical`.** It is not, so the `0.12` reranker cutoff can drop the block from the prompt *even when hits exist* -- the panel then truthfully reports hits that the model never saw. This is a distinct failure from `(0)` and no one has been looking for it.
3. **Move the category filter before the KNN, or delete it.** It currently drops rows *after* the top-30 (`:425`), and the file's own comment measures it at `hit@5 = 0/28`. Post-filtering a fixed-size candidate set is a classic recall killer: you pay for 30 candidates and keep whatever survives.

**Do NOT adopt ParadeDB / `pg_search` for this.** Verified real and healthy (9,215 stars, v0.25.6 released 2026-08-27, built on Tantivy + pgrx) -- and wrong here on two counts: it is **AGPL-3.0**, and statenour runs on **Neon**, which gates the extension list. `tsvector` + `pgvector` + RRF in raw SQL is already the house pattern (`AGENTS.md`) and already written. Adopting a search engine to solve a wiring problem is the single most seductive mistake available in this project.

### 4.2 What retrieval still will not do (be honest about this)

Even fully fused, this is lexical + dense + recency over a flat store. It has no entity resolution, no temporal reasoning beyond a recency multiplier (`memory-recall.ts:406`), and no graph walk. `MemoryEdge` (`prisma/schema.prisma:2091`) exists and is unused -- another dark wire, and the natural substrate for the audit's write-time-linking idea (item 5 of its memory section). That is 90-day work (section 10), not now.

---

## 5. Target architecture

### 5.1 The four critical paths

```
NORMAL CHAT TURN (target p50 unchanged, ~70% of turns)
  classify(risk=low) -> stream as today -> onFinish: gate=telemetry -> persist
    No buffer. No added latency. The gate records; nothing blocks.

MEMORY-HEAVY TURN
  classify -> retrieve{dense + lexical + exact + durable} -> RRF -> rerank
    -> provenance:=OK|ZERO|ERROR|UNMEASURED  <-- never collapses to []
    -> if ERROR: prompt carries "memory lookup failed this turn", and the
       reply is FORBIDDEN from asserting recall ("you told me on the 3rd")
    -> stream -> onFinish: gate

HIGH-RISK FACTUAL TURN (recommendation / named resource / health / numbers)
  classify(risk=high) -> BUFFER via generateText (no flush)
    -> evidence gate: facts, length, named-source receipts, novelty
    -> verdict=block  -> repair pass (strip/hedge/shorten) -> re-gate ONCE
    -> verdict=block again -> deterministic fallback, never a third model call
    -> fake-stream the survivor (simulateStreamFromText, already at
       alternate-paths.ts:349)

EXTERNAL-ACTION TURN
  classify -> preconditions -> dry-run -> approval if side-effecting
    -> execute with idempotency key -> receipt row -> postcondition check
    -> reconcile against source of truth -> gate on receipt, not on prose
```

### 5.2 Risk-classified buffering (upgrade 5) -- the load-bearing change

The gate has teeth only where a complete reply exists un-flushed. Do **not** buffer everything: that trades your best property (fast, live, conversational) for a guarantee most turns do not need.

Buffer when *any* holds, computed pre-generation from the user message alone:
- the ask is for resources/recommendations (names will be emitted),
- the domain is health/pharmacology/legal/financial,
- the turn is factual **and** no tool is expected to fire,
- the operator asked for a commitment or a number.

Expected coverage: ~15% of turns (INFERRED -- instrument before trusting; that is Experiment E3). Everything else keeps today's path.

Reuse, do not rebuild: `alternate-paths.ts` already buffers into `winner` (`:305`) and fake-streams (`:349`); `pre-stream-regen.ts:154` already has regen machinery. The work is a new always-on `NICK_BLOCKING_GATE` branch that buffers **without** also enabling deep-reasoning/self-consistency semantics, plus lifting the action-intent self-suppression at `:162` for the buffered-gate case only.

**Kill criteria:** if buffered-path p95 exceeds +3.5s, or the buffered share exceeds 25% of turns, revert the classifier to resource/health only.

### 5.3 The gate state machine

```
                +-------------------+
   reply ---->  |  EVIDENCE GATE    |
                +-------------------+
                  |       |        |
               pass    repair    block
                  |       |        |
                  |       v        v
                  |   [repair]  [repair]      <-- deterministic first:
                  |       |        |              strip unearned tags,
                  |       |        |              hedge, truncate to spec
                  |       +---+----+
                  |           v
                  |      [re-gate ONCE]       <-- exactly once. Never loop.
                  |        |        |
                  |     pass      still block
                  |        |        |
                  v        v        v
              +------------------------------+
              |  SHIP        |  FALLBACK     |  <-- deterministic text:
              +------------------------------+      "I don't have a verified
                                                     source for that. Want me
                                                     to actually search?"
```

Three rules that keep this from becoming a latency bomb or a quality regression:

1. **Repair is deterministic before it is generative.** Stripping an unearned `[confirmed]`, truncating to the shape ceiling, and hedging an unverified sentence are string operations. Only reach for a model call when deterministic repair cannot satisfy the verdict.
2. **Exactly one re-gate.** A regenerate loop under an adversarial scorer is a reward-hacking machine and an unbounded latency risk.
3. **The fallback is a constant, not a generation.** A fallback that can itself fail is not a fallback.

`runEvidenceGate()` in this branch implements the verdict; the state machine above is the consumer still to be built.

### 5.4 Register (upgrade 8)

The header advertises "auto posture / auto depth" over two constants. Rather than resurrect the dead posture path, classify server-side from the turn and inject a register block. The live classifier is `inferPersona()` (`lib/ai/intent-classifier.ts:137`) -> `master | builder | friend`; four of five persona blocks hard-code an imperative close (`finalize-system-prompt.ts:159`: *"Always end with ONE next move"*), which is precisely the audit's one-shape finding, in a string.

| Register | Trigger | Shape | Hard rule |
|---|---|---|---|
| COACHING | drift, avoidance, habit | current shape is right | keep the close |
| TECHNICAL | bug, tool, app behaviour | diagnosis -> fix -> stop | **no** hook, **no** imperative close |
| HEALTH | dosing, stacking, timing | numbers hedged, source named or absent stated | never state a pharmacokinetic figure as fact; name cardiovascular load once |
| META | auditing NICK, prompt requests | cold, third-person about the system | no warrior register, no "go" |
| SOCIAL-STAKES | a commitment, a disclosure with consequences | adversarial | must surface the contradiction before agreeing |

Also delete the dead path while you are here: `setPosture`/`setDepth`, the unreachable `"spar"`/`"execute"`/`"counsel"` branches, and the header's gold-tint-on-non-default that can never trigger. Leaving unreachable code next to the live path is how the next reader concludes register control exists.

---

## 6. Schemas

### 6.1 Memory provenance (upgrade 7) -- mostly already in the schema

`BrainMemory` already carries `trustTier`, `createdBy`, `validFrom`, `validUntil`, `supersededById`, `lastVerifiedAt`. **`trustTier` has zero readers and zero writers.** The work is activation, not migration:

```
trust_tier            already exists, never written
  OPERATOR            Nour said it.               decays slowest, cites freely
  SYSTEM_DERIVED      computed from his data.     cite with the derivation
  AGENT_INFERRED      Nick concluded it.          must be marked as inference
  EXTERNAL_CONTENT    scraped/searched.           must carry a source URL

-- to add
verified_by_tool_call_id  text null   -- the receipt that grounded it
source_url                text null
last_contradicted_at      timestamptz null
```

Recall must **rank** by tier, not merely store it: today a scraped article ranks identically to something Nour said. Display must show it: a memory Nick inferred and a memory Nour stated must not look the same in the panel -- that is the same false-confidence defect as `[confirmed]`, one layer down.

### 6.2 Tool receipts (new)

```
tool_receipt
  id, conversation_id, message_id, turn_id
  tool_name, args_hash, idempotency_key
  status          ok | error | timeout | refused
  result_digest   text        -- normalized result text, for name matching
  entities        text[]      -- proper nouns the call resolved
  started_at, duration_ms
```

`entities` is what makes upgrade 3 cheap at scale: the named-source checker currently normalizes the whole result blob. This is also the substrate for exactly-once semantics on action turns (`idempotency_key`) and for the duplicate-action prevention the second brief asks for.

### 6.3 Commitments (upgrade 9)

The audit's sharpest product observation: the taper plan was discussed three times with zero corresponding action. Memory that only remembers prose is a diary, not an operator.

```
commitment
  id, stated_at, text, category
  status        stated | started | lapsed | done | abandoned
  restated_count int      -- the adversarial hook
  due_at, mission_id null -- FK once authorized
  evidence_of_start jsonb  -- what would prove it began
```

Rule: on write, if an open commitment in the same category exists with `status='stated'` and no `evidence_of_start`, the reply **must** surface it before agreeing. `restated_count >= 2` escalates register to SOCIAL-STAKES. **Creating the Mission row is an authorized action, not an automatic one** -- see section 9.

---

## 7. Evals

### 7.1 The golden set is your own transcript

The single highest-value eval asset is the session the audit was drawn from. Convert each observed failure into a frozen case with a deterministic assertion:

| Case | Assertion | Deterministic? |
|---|---|---|
| 525-word / 1-of-5-unverified turn | `severity > 0 && verdict != "pass"` | yes -- **shipped** |
| "Stoic Strategy" turn | `verdict == "block"` with no receipt | yes -- **shipped** |
| `[confirmed]` with no tool call | tag stripped | yes -- **shipped** |
| banner-prefixed turn | rendered text contains no `VERIFIER` | yes -- **shipped** |
| embedding returns `[]` | panel says "failed", not "(0)" | yes -- **shipped** |
| "cutting back starting tomorrow", 2nd statement | prior instance surfaced before agreement | yes (row lookup) |
| Adderall timing question | no unhedged pharmacokinetic figure | mostly (regex + NLI) |
| iOS backgrounding question | no imperative close, no hook | yes |
| repeated Huberman/Naval/Goggins | novelty check fires | yes (history lookup) |

**Nine of eleven are deterministic.** That is the point: the brief asks where deterministic software beats another LLM call, and the answer here is *nearly everywhere*. Reach for a judge only on register appropriateness and hedge adequacy, and only with measured inter-rater agreement against your own labels first.

### 7.2 Preventing the eval system from being gamed

Four rules, each earned by a documented incident in this repo:

1. **Every gate ships a canary pair** -- break it, assert failure; run it clean, assert pass. A permanently-broken gate otherwise scores green (`AGENTS.md`; precedents `policy.test.mjs`, `lintGateFailClosed.test.ts`).
2. **Every new detector ships a positive control.** A new function cannot regress against code that never called it. The audit-replay test in this branch asserts the *old* gate still scores that turn `0`.
3. **When a test resists a correct fix, read the test as a finding.** Precedent: `expect(view.score).toBe(7)` on an empty ledger encoded the bug it was written during.
4. **Never assert source text** (`not.toContain("catch")`) -- it false-fails on a reformat and passes on a rename. Assert behaviour.

### 7.3 Online metrics that would have caught this in a day

| Metric | Alarm |
|---|---|
| `recall_provenance` distribution | any sustained `ERROR` share > 2% |
| gate `verdict` distribution | `block` > 10% (over-blocking) or `block` == 0 for 24h (silently disabled) |
| named-source claims per turn vs receipts per turn | ratio > 1.2 |
| turns with `toolCalls == 0` **and** named resources emitted | any |
| unearned-tag strips | any (should trend to zero as the prompt learns) |

The second row is the one that matters most and is the one nobody builds: **a gate that never fires and a gate that is turned off produce identical dashboards.** Alarm on silence.

---

## 8. Stopping the regression at its source

The eleven dark wires are a process defect. Two mechanical guards, both cheap:

1. **Consumer-coverage check in CI.** For each exported detector/scorer in `lib/ai/**`, assert at least one non-test, non-barrel importer that *branches* on its return value. The repo already has the doctrine as a skill (`assert-the-consumer`); this makes it enforceable. Start it as a frozen allowlist of today's violations so it fails only on *new* ones -- otherwise it lands red and gets disabled, which is the same disease.
2. **Flag-age alarm.** Any `status: "experimental"` flag default-off for > 60 days is either promoted or deleted. `NICK_VERIFIED_REGEN` describes its own defect in its `defaultBehavior` string and has sat there regardless.

---

## 9. Self-healing: what may be autonomous, and what may not

The brief is right to reject "the agent reflects and fixes itself." The useful split is by **blast radius**, not by how clever the recovery is.

| Tier | Examples | Autonomous? | Controls |
|---|---|---|---|
| **A. Runtime recovery** | retry with backoff on a 5xx, circuit-break a failing tool, fall back to a secondary model, degrade to a deterministic reply | **Yes** | idempotency keys; bounded retries; **never retry a side-effecting call without one** |
| **B. Diagnosis + eval generation** | cluster failures, mint a regression case from a failed turn, open an incident row | **Yes** | write-only to an eval/incident store; a generated case cannot auto-merge to the blocking set |
| **C. Config change under canary** | shift a retrieval weight, adjust a rerank cutoff, change a routing threshold | **Conditionally** | shadow first; canary <= 10%; auto-rollback on metric regression; every change reversible in one step and logged with its trigger |
| **D. Prompt / code / security-policy mutation** | edit the system prompt, change a gate threshold, widen a permission | **No** | human review, always. A system that can rewrite its own gate has no gate |

Two rules that make tier C safe rather than nominally safe:

- **The metric that triggers a change may not be the metric that validates it.** Otherwise the loop optimizes its own trigger -- Goodhart with extra steps.
- **A kill switch that requires the system to be healthy in order to fire is not a kill switch.** It must be a static config read on every turn, with a deterministic default, and it must be exercised on a schedule -- an untested kill switch is a comment.

Explicitly **not** self-healing: the reply gate. A gate that adjusts its own thresholds when it blocks too much will converge on blocking nothing, which is exactly the state you started in.

---

## 10. Execution

**First 24 hours.** Land this branch. Add the `recall_provenance` and gate-`verdict` metrics (section 7.3) -- shipping the fixes without the dashboards means you cannot tell whether they fired. Instrument the buffered-turn share for E3 without changing behaviour.

**First week.** Risk-classified buffering (5.2) behind `NICK_BLOCKING_GATE`, on for the operator only, with the gate state machine (5.3) as its consumer. Fuse the lexical + exact-term lanes into `memory-recall` (4.1) and mark Hybrid Recall `critical`. Run E1 offline.

**First 30 days.** Activate `trustTier` on write and rank on it (6.1). Tool-receipt table (6.2). Register classifier reaching the prompt, dead posture path deleted (5.4). Consumer-coverage CI gate over a frozen allowlist (8). Commitment extraction, surfacing only -- no writes yet (6.3).

**First 90 days.** Commitments -> Missions with explicit authorization. `MemoryEdge` activated for write-time linking. Contradiction *resolution* (supersession chains) rather than detection. Entity resolution across memories. Only now consider a graph store, and only if `memory_edges` in Postgres has demonstrably hit a wall.

---

## 11. Experiments, ranked by uncertainty reduced per unit cost

| # | Question | Method | Accept | Kill |
|---|---|---|---|---|
| **E1** | Does `search_query` on the query side improve recall? | offline: 100 transcript-derived queries with labelled gold memories; measure hit@5 both ways | hit@5 +>=10% with no threshold retune | any regression, or the gain vanishes after retuning thresholds -- then it was a threshold artefact |
| **E2** | What *is* the real recall failure rate? | ship provenance (done), read the `ERROR` share for 7 days | -- | -- (pure measurement; the single highest-information experiment here) |
| **E3** | What share of turns are high-risk? | classify-only, no behaviour change, 7 days | <= 20% -> buffering is cheap | > 30% -> narrow the classifier before building the buffer |
| **E4** | Does the named-source checker over-block real prose? | run against 30 days of stored replies; count would-be blocks; hand-label | FP <= 2% | FP > 5% -> demote `block` to `repair` for that signal |
| **E5** | Does removing the post-KNN category filter improve hit@5? | offline, same corpus as E1 | any improvement | -- (its own comment already measures 0/28; expect improvement) |
| **E6** | Does register classification change perceived quality? | blind A/B on 20 paired replies, operator labels | preference >= 65% | <= 55% -> the register table is a hypothesis, not a finding |

E2 and E3 cost nothing but instrumentation and gate everything after them. **Do them first.**

---

## 12. What to delete

Additive-only change is how the eleven dark wires accumulated.

- `setPosture` / `setDepth` and the unreachable `"spar"` / `"execute"` / `"counsel"` server branches.
- The `"auto posture . auto depth"` header, or wire it to something real. A read-only mirror of two constants that gold-tints on a value that can never occur is worse than absent -- it advertises a control that does not exist.
- The post-KNN category filter (`memory-recall.ts:425`), pending E5.
- The `v10.0.162` literal, hardcoded in **two** files with no drift guard, naming a version `AGENTS.md` records as retired.
- `nick-prime-context.ts`, unless a consumer lands with it.
- Any `experimental` flag default-off past 60 days: promote or delete.

---

## 13. Adversarial review of this blueprint

**"It is overengineered."** Partly true. Sections 6.2, 6.3 and the 90-day graph work are speculative against a single-operator product. The defensible core is upgrades 1-6; everything after is optional until E2/E3 report. I have marked the critical path accordingly rather than pretending nineteen subsystems are all load-bearing.

**"It will make NICK slower and worse."** The real risk. Buffering costs 1-3s on the buffered share; if the classifier is loose, that becomes most turns and the product's best property dies. Mitigations: measure the share before building (E3), hard kill criteria (5.2), deterministic-repair-before-generative (5.3). And the false-positive floor is a first-class test in this branch, not an afterthought -- a gate that blocks "Go run. You already know the answer" would be a worse product than one that occasionally invents a channel.

**"The memory design could become creepy or wrong."** Trust tiers and commitment tracking make NICK more confidently assertive about the operator's life, and a *confidently wrong* memory is worse than a vague one. Hence: inferences must render as inferences, `restated_count` must be surfaceable rather than auto-escalating, and commitments must not become Missions without authorization. The failure mode is not a privacy leak, it is an operator who stops trusting the panel because it was assertive and wrong once.

**"Self-healing hides instability."** Yes -- tier A recovery masks the failure rate it is recovering from. That is exactly what happened here: five layers of `catch -> []` are "graceful degradation", and they concealed a broken retrieval lane for an unknown period. Every recovery must **increment a counter and be alarmable**. Degradation without a metric is concealment.

**"Open-source adoption expands attack surface."** Which is why this blueprint recommends adopting almost nothing. The one verified-and-rejected candidate (ParadeDB) is rejected on licence and platform, not on quality.

**"Evals will optimize the wrong thing."** The sharpest risk. Nine of eleven golden cases are deterministic, which bounds it, but a gate scored by a judge that a generator learns to satisfy produces polished, hedged, useless replies. Countermeasure: the gate scores **evidence**, never style, and the false-positive floor tests are the guard against style creep.

### The minimum that still achieves a step change

If only three things ship: **the evidence gate wired to a real consumer (5.2 + 5.3), three-state recall provenance (shipped), and the lexical-lane fusion (4.1).** Those three address every failure the audit actually observed. Everything else in this document is compounding, not load-bearing.

---

## 14. Unknown-unknowns register

| Assumption | Can't verify from here | Instrument |
|---|---|---|
| The `(0)` was an embedding failure | no prod logs in this session | E2 |
| High-risk turns are a minority | no turn distribution | E3 |
| The corpus is populated enough that `ZERO` is genuinely rare | no row counts | count `brain_memories` by tier over 30d |
| `search_document` measurably hurts recall here | needs the real index | E1 |
| Named-source FP rate is low enough to block on | tested on constructed cases only | E4 |
| Nobody depends on the verifier banner being visible | grep-clean is not usage data | watch for confusion after the strip ships |

The last row is the one to hold loosely: **code-grep is not evidence of non-use in either direction.**
