# Nick's customers · what three months of calls and texts can and cannot tell us (2026-09-23)

**Answer first.**

1. **This session did not read the production corpus.** There was no database credential in the
   container. The only route to one was the Railway variable listing, which prints every production
   secret in plaintext into the transcript, and that exposure was judged not worth it. The Neon
   (statenour) database holds no call or SMS corpus (I checked the table list). So this document
   contains **zero new customer-corpus facts**. It contains:
   - about 40 dated production measurements from earlier sessions, each labelled as such;
   - 18 defects verified in code this session that shape what customers experience;
   - the one command that runs the three-month analysis read-only against production. It is built,
     tested, proven end-to-end on a synthetic fixture, and waiting on one operator run:
     `railway run -s MAINnicks-tire-auto -- pnpm diag:customer-corpus -- --since 2026-06-22 --until 2026-09-22 --json`.
2. **A true 2026-06-22 → 09-22 transcript corpus does not exist.** Full transcripts were archived
   only from about **2026-07-23**. From 07-12 there are customer turns only (12 turns × 300
   characters). The 06-22 → 07-11 weeks hold only assistant-written summaries, which measure the
   assistant's vocabulary, not the customer's (§2). **The analysable window is about 60 days of
   transcripts plus 11 days of customer-only turns.** The census prints the actual coverage week by
   week before any finding.
3. **The strongest customer-facing problems are already visible in code and earlier measurements.
   None of them needs new architecture.**
   - The assistant tells tire callers "I've sent the tire info to the shop" when nothing but the
     call log is stored.
   - A tool description still instructs the model to promise a "15 min callback" that the system
     prompt forbids and nothing tracks.
   - 45 texted customers are waiting on a human. 27 of them have waited more than 30 days, and the
     only way to close one is to send a text, because the "no reply needed" procedure has no UI
     caller.
   - One Android phone carries about 80% of customer texting with no fallback. It was offline for
     about 18 hours on 09-21/22.
   - The call is recorded but the greeting discloses neither the recording nor the AI.
   - The demand classifier that can actually read "I need two tires" is built, tested and wired to
     nothing.
4. **Tonight's work (Part A) is honest and mostly well-instrumented, but it points inward.** Four of
   the six new docs concern the owner assistant's memory and the cron and queue plumbing. The two
   items that touch customers — the offline SMS gateway and the unanswered replies — got a few
   lines each. The next hour is better spent on §6's top five than on another census.

**Evidence labels used throughout.**

| Label | Meaning |
|---|---|
| **REPO** | Verified repo fact: read in code at `origin/main` d72823e this session |
| **CORPUS·prior** | Customer-corpus fact measured read-only in production by an earlier session, with its date and source. Not re-verified this session. |
| **EXT** | External fact from a source, with date. Two load-bearing ones were re-fetched and confirmed this session: τ-Voice numbers and the TiDB SKIP LOCKED PR. The rest were agent-sourced from primary or secondary pages. |
| **INFER** | Research inference |
| **EXP** | Experimental idea |
| **OPERATOR** | A decision only the operator can make |

---

## Part A — Cross-examining what landed on 2026-09-22

### A1. The six new docs, placed on the ladder

The ladder: BUILT ≠ WIRED ≠ TESTED ≠ DEPLOYED ≠ LIVE-OBSERVED ≠ OUTCOME-PROVEN.

| Artifact | Highest rung reached | Customer reach | Verdict |
|---|---|---|---|
| `NICK-MEMORY-COUNTERFACTUAL` + writer guards (`memoryWriterGuards.ts`, 125888a) | Guards are TESTED and DEPLOYED (merged). The prune is operator-run, so it is not LIVE. The doc itself says OUTCOME is "next step". | **Nearly none** (see A2) | KEEP the guards. The doc has a **scope gap**: it traces two reach paths and misses a third, the receptionist-lesson path (A2). |
| `NICK-MEMORY-EVICTION-SIMULATION` | A MEASURED diagnostic; two policies rejected | None | KEEP as dated evidence. Do not cite it as current. |
| `NICK-MEMORY-PROVENANCE-MODEL` | DESIGNED only: no writer, no reader, no test | None | **PARK.** It is a design with no consumer. It should not sit beside measured docs in `docs/operations/` as if it were operating truth. Move it under `docs/plans/`, or fold it into the counterfactual doc's "next" section. |
| `CRON-OUTCOME-CENSUS` | MEASURED, with a reproduce command | **High, but only in one paragraph**: the SMS gateway incident | KEEP. The gateway finding deserved its own incident row, a fallback decision, and a customer-impact count: how many customer texts were queued or held, and how many were delayed past their usefulness. |
| `QUEUE-CENSUS` + `orchestration-status-reconcile` | MEASURED. The reconcile job is BUILT and TESTED; no live-run receipt was found this session. | **High**: 45 customers waiting on a reply, 3 emergency rows, a 308-row status lie | KEEP. Its "operator decides #1" is **partly a code gap, not only a staffing gap**. `smsConversations.markNoReplyNeeded` (`server/routers/smsConversations.ts:387`) has no client caller (REPO, grep: zero hits in `client/src`). A `human_pending` row can only close by sending the customer a text, so the queue *cannot* be drained honestly. Wire the button before asking a human to drain it. |
| `CRON-INVENTORY.md` regenerated | Generated artifact | None | KEEP. It is generated, so it is not a finding. |

### A2. The memory work barely reaches customers — and the doc missed its one route to them

- **REPO.** Nick's memory reaches the *customer-facing* receptionist through one path:
  - `updateAssistant()` → `getPromptLessons()` (`server/services/vapi.ts:1660-1667`,
    `server/services/nickMemory.ts:263-278`) appends the top 3 `lesson` rows to the Vapi system
    prompt.
  - This happens only on the operator's manual "Push Latest Config".
- **REPO.** That path filters on `source === RECEPTIONIST_LESSON_SOURCE`
  (`nickMemory.ts:258`). So the junk `feedback_loop` lessons the counterfactual found at 100%
  confidence ("Alert 'proactive' was unknown. Outcome unknown.") **cannot** reach callers. I
  checked; this is not a live defect.
- **The residual risk:** `recall({type:"lesson", limit:50})` takes the top 50 lessons by confidence
  *before* the source filter. Receptionist lessons can be starved once 50 or more higher-confidence
  lessons from other writers exist. Today there are 5 `feedback_loop` rows, so it is dormant.
- **INFER.** The memory fixes raise the quality of the operator's own assistant. That is StateNour's
  "Operator Dividend", legitimately, but it is not customer experience. Rank it accordingly.

### A3. `now.md`, the memory entries, and what to promote, demote or delete

- **UNKNOWN.** The five new memory entries live in the machine-local
  `~/.claude/projects/C--Users-nourd-NOURCITY/memory/`, which is not in this clone. I judged them
  from their titles only.

| Item | Action | Why |
|---|---|---|
| "capability-ledger-updated satisfied by ledger diff" | **PROMOTE to a gate fix, then DELETE the memory** | A memory that teaches agents how to satisfy a gate by editing a file is a false-green generator. If any ledger diff satisfies the requirement, the requirement should instead check that the diff touches the entry for the capability this PR changes. |
| "bare squash merge drops co-author trailer" | **PROMOTE to a script check** | `gh pr merge --squash` without `--body` is a mechanical rule. A merge helper, or a CI check on the squash commit, enforces it; a memory only hopes. |
| "git add aborts on one bad pathspec" | **DELETE** | Generic git behaviour; costs index space. |
| "TaskStop kills wrapper not tree", "Railway CLI rate limiting + ledger render check" | KEEP | Real, non-obvious harness traps. |
| The three extended memories (store verdict, hourly tier, join-key proxy) | KEEP | Extending beats duplicating. |
| `.remember/now.md` | **DEMOTE history** | 1,276 lines. A handoff is read at session start; everything older than the last two waves belongs in a dated archive file. Its value is the top 60 lines. |
| "Completed + 0 must say what it examined" (census rule) | **PROMOTE to an executable invariant** | A test over every registered cron's zero-record `details` string: it fails when a zero-record run has no denominator or reason. #2514 started this; the census names five jobs still silent. |
| "Every status-bearing table has a drain or a terminal state" (queue census) | **PROMOTE** | A registry test: each status table lists `drain: <job or UI procedure>` or `terminal: true`, and the test fails on a new status table with neither. |

### A4. What the night got right, stated plainly

The refuted self-audit hypothesis kept in `now.md`, the exact-body-join proxy caught in
`QUEUE-CENSUS`, and the extractor found dead by a production probe (#2547) are all the right
behaviour. The critique is about **where the attention went**, not the quality of the work.

---

## Part B — The corpus: what exists, what was measured before, and the instrument

### §1. Access this session

- **REPO/ENV.**
  - No `DATABASE_URL`, no Railway CLI and no `node_modules` in the container at start.
  - The Railway MCP is authenticated, but its `list-variables` returns every service variable in
    plaintext. I declined it. Pulling all production secrets into a model transcript to run SELECTs
    is out of proportion to the ask, and the repo's own pattern (`railway run … pnpm diag:*`)
    exists precisely so no key is printed.
  - Neon (statenour) tables were listed: no call or SMS corpus. `bridge_call_logs` is bridge API
    calls, not phone calls.
- **Consequence:** every customer-corpus statement below is **CORPUS·prior** or a hypothesis for
  the census to test.

### §2. Coverage that actually exists for 06-22 → 09-22 (CORPUS·prior, dated)

| Window | Full role-tagged transcript (`vapi_call_archives`) | Customer turns only (`metadata.customerSpeech`) | What else |
|---|---|---|---|
| 06-22 → 07-11 | **none** (Vapi purges at 14 days; the archive, migration 0109, was applied 2026-08-06) | none | `aiSummary` (assistant-written), binary `serviceMention`, uncalibrated `intents`, `endedReason`, duration |
| 07-12 → 07-22 | none | yes: 363 calls backfilled at 99.7%, capped at 12 turns × 300 characters | same |
| ~07-23 → 09-22 | **yes**, assuming the first archive pass got the whole 14-day window (not verified); archive completeness after 08-08 has **never been measured** | yes | transfer artifact on 109 calls, all-time; speaker attribution and the new demand fields only from 09-18 |

Sources: `scripts/data-census.ts:46-47`, `docs/audits/call-mix-2026-07-26.md:95-100`,
`capability-ledger.json` (`vapi-call-archive`, lines 1843 and 1877), `server/services/vapiCallArchive.ts:26-28`.

**SMS coverage caveats (CORPUS·prior):**
- May 2026 failures dominate `sms_messages` (5,184 of 5,346).
- Opt-out records start only 2026-07-13; earlier STOPs were dropped.
- `sms_response_jobs` and `expected_arrivals` were missing in production 07-21 → 07-26.
- Operator replies write two rows.
- The 308 orchestration rows stuck at `queued` (fixed by the reconcile job going forward).

### §3. What earlier production reads already established (CORPUS·prior)

| Fact | Value | Date · source |
|---|---|---|
| Inbound call volume | 2,094 in 90 d (~23/day); 986 in 30 d (~33/day) | 07-26 · `vapi_call_logs` (MIX) |
| Forwarded to a human (`assistant-forwarded-call`) | 40.3% (843/2,094); 41.5% on 08-05 | 07-26 · 08-05 |
| Callers whose **first substantive words** ask for a person | 20.9% (conservative) – 24.9% (classifier), n = 363 | 07-26 · customer turns |
| …of those, forwarded promptly | 94.7% (72/76); median 2 customer turns before the forward | 07-26 |
| First-turn demand (n = 363, deterministic tier) | human 24.9% · generic tire 16.1% · brakes 5.2% · used-tire price 2.7% · oil 2.5% · **unclear 34.2%** | 07-26 |
| Blocking friction on the first turn | **price uncertainty 32.0%** · human required 24.9% · transportation 2.7% · unknown 35.5% | 07-26 |
| Forward then redial within 15 min | 28% (280/1,016, 90 d); 22% (48/214, 14 d); 24% (57/240, 14 d, ~09-18) | 08-05 · 09-18 |
| Warm transfer (experimental plan, live since 09-21 13:57Z) | 11 of 11 forwards `connected`; fallback never fired; **n = 11** | 09-22 |
| Very short turns | 50% of 1,460 turns were 3 words or fewer; 16.4% hesitation stubs; "Hello? Hello?" is the most common opener | 08-07 · `stt-forensics.ts` |
| Calls with fewer than 2 caller turns | 18% (89/492) | 08-08 |
| Assistant latency | Time to first audio p50 0.40 s; reply gap p50 0.90 s, p90 2.29 s | 07-27, n = 100 |
| Inbound texts | 43 in 30 d (09-22); 58 customer turns in 180 d (07-25) | ledger · ROS-058 |
| Texts unanswered within 2 h | **74%**, including 10 opt-outs; automated reply p50 6 s against operator reply p50 4.5 min | 07-25, 180 d |
| Texts waiting on a human | 45 `human_pending`: 25–27 over 30 d; 6 are carrier bounces, ~5 vendor spam | 09-22 |
| Expected arrivals, 30 d | 116 written (all voice): 15 arrived · 89 no-show · 12 open. **66 of the 89 never named a day; 63 were price or inquiry calls** | 09-22 |
| Promise ledger | `customer_promises` = **0 rows** | 09-22 |
| Voice recovery | 110 of 110 dials failed with a 400 error (06-18 → 09-20) | 09-22 |
| Invoices | ~105–145 paid per month; 73 in the 30 d to 09-22 | CT:293 · now.md |
| One-and-done customers | 77% ("VERIFIED 2026-07-19"; source query not located) | `data-census.ts:50` |

**INFER — the cross-examination these numbers demand.**

1. **"Tire-first is not supported by caller speech" (MIX addendum) overreaches.** It is a
   *first-turn* measurement, and a quarter of first turns are "get me a person", which hides the
   need. The census's `episodeNeed` reads every turn, so the real tire share is still unknown. It
   is somewhere between 16% (generic tire, first turn) and a much larger number once human-first
   callers' later turns are read.
2. **"Forwarded" was never "connected" before 09-18.** Every transfer-success figure before the
   warm-transfer plan is an attempt count. The 22–28% 15-minute redial rate is the best proxy for
   failed handoffs in that period.
3. **The arrivals kernel mostly measures the assistant, not the customer.** `bookSlot` fires for any
   non-tire walk-in lead and in parallel with every transfer (`shared/callTaxonomy.ts:275-290`, REPO),
   so "no-show" means "no invoice". The honest reading of 15 arrived out of 116 is a lead-to-invoice
   rate, not a broken-commitment rate.

### §4. The instrument (built this session; the operator's one gate is running it)

`pnpm diag:customer-corpus` — `scripts/diagnostics/customer-corpus-census.mts` plus the pure
library `scripts/lib/customerCorpus.ts`.

- **Read-only.** Every statement is a SELECT. It reads `vapi_call_logs`, `vapi_call_archives`,
  `sms_messages`, `sms_conversations`, `callback_requests`, `expected_arrivals`,
  `sms_response_jobs`, `customer_promises` and `invoices`.
- **Episodes are built by a 24-hour gap across call and SMS.** An outbound-only run never opens an
  episode. The live kernel's fixed-bucket count is printed beside it.
- **The need is read with the existing `classifyVoiceDemand`** (`server/services/voiceDemandClassifier.ts`),
  applied to every turn. An opening "get me a person" is kept as a separate fact. The census adds
  **no third taxonomy**, and it is that classifier's first reader over live data.
- **Per need, it prints:**
  - redials within 2 h;
  - call + text episodes;
  - after-hours starts (hours come from `BUSINESS.hours.structured`);
  - transfer attempted vs the provider's `connected` / `not_connected` verdict;
  - callback row vs callback done;
  - assistant promises, and whether a *delivered* outbound text or a completed callback followed
    within 26 h (a failed text does not count — a defect this session's fixture run caught and
    fixed);
  - arrival row vs arrived;
  - invoice **linkage** within 14 d, split into new and existing customers and labelled "not
    causation";
  - friction phrases;
  - opt-outs.
- **Repeated-fact burden:** it flags a tire size or vehicle given in an earlier call of the episode
  that the assistant asks for again.
- **What the assistant asks:** size, vehicle, name, phone, quantity. **What it promises:** callback,
  text, rack check, status update.
- **Texts:** first-reply latency split by open and closed hours, last inbound left unanswered,
  `human_pending`, opt-outs, failed outbound.
- **Classifier disagreement:** calls where the live kernel found no intent but the demand
  classifier found a tire need.
- **Privacy:**
  - Phones become a per-run salted hash.
  - `--excerpts N` prints only masked windows of at most ~15 words, and `maskPII` runs before any
    match.
  - `--json` is aggregate-only.
  - **Known masking limit:** a name that is not introduced ("my name is…", "this is…") survives
    masking. Treat `--excerpts` output as sensitive and do not commit it.
- **Proof it measures something:**
  - `scripts/lib/customerCorpus.test.ts`: 21 tests, including two positive controls that pin the
    live-kernel defects.
  - `scripts/diagnostics/customerCorpusCensus.fixture.test.ts`: 7 tests running the real runner
    end-to-end on a synthetic fixture.
  - Mutation checks: breaking sessionization reddened 3 tests, dropping phone masking 2, narrowing
    the tire pattern 1, counting failed texts as follow-up 1.

**What the census still cannot see (operator-side exports if these matter):**
1. The audio. Accent, noise and ASR errors need `recording_url` while it is live, or Vapi
   stereo recordings copied to our own bucket. Vapi retention is 14 days on Usage-only and 30 on
   Core, so the plan tier matters.
2. MMS and photos. `sms_messages` has no media column; media lives in the gateway payload.
3. Counter conversations. Zero episodes exist beyond one selftest row.
4. Whether a human called back from a personal phone. It leaves no row, and this is the largest
   blind spot in every callback metric.

---

## Part C — Findings from code this session (REPO), ranked by customer effect

| # | Finding | Evidence | Customer effect (INFER) |
|---|---|---|---|
| 1 | Ordinary tire inquiries are told **"Got it — I've sent the tire info to the shop"** while nothing is persisted except the call log. The admin lead was removed 2026-06-05 as noise. | `server/routers/voiceAgent.ts:628-644` | The customer believes the counter has their size and vehicle; the counter does not. A walk-in or redial starts from zero: the textbook "repeat yourself" cause. |
| 2 | `tireInquiry.notes` still tells the model to write **"promised 15 min callback"**, while the system prompt says "NEVER promise a callback or a timeframe — nobody is tracking that promise". The legacy path writes a lead but **no** `customer_promises` row. | `server/services/vapi.ts:627` vs the RACK-CHECK section (`:354`); `voiceAgent.ts:626-700` | An untracked 15-minute promise is possible in any call where the model follows the tool text over the prompt. |
| 3 | The CALLBACK CAPTURE prompt section says "I'll send this to the shop so someone can follow up" and routes to `sendConfirmationSms`, not `escalate`. Only `escalate` and `scheduleCallback` write a promise. | `vapi.ts` CALLBACK CAPTURE section; `voiceAgent.ts:337-360` | A spoken follow-up promise with no obligation row. It helps explain `customer_promises = 0`. |
| 4 | `detectIntents` (the live eval classifier) has **no pattern for a bare tire request**: "I need two tires for my Honda", "do you guys have tires" and "I need a tire" all give `[]`. It also misses a spoken size ("two two five sixty five seventeen"). | `server/services/vapiCallClassifier.ts:31-54`; pinned by a positive control in `customerCorpus.test.ts` | Plain tire buyers land in `unknown` / `unclassified`, and every tire-share and queue figure understates the core business. |
| 5 | `voiceDemandClassifier.ts` reads those phrases correctly (`tire_service`), has `rack_check`, `active_job_status` and a friction taxonomy, and is **imported by nothing but its own test**. It misses "the wheel came off" (tire_service, not safety) and spoken sizes. | `grep classifyVoiceDemand`: one test file | BUILT + TESTED + UNWIRED: the doctrine's prime target. |
| 6 | `episodeKey` buckets by fixed UTC day (boundary 8 PM EDT / 7 PM EST) **and** keys on intent family. A tire call followed 40 minutes later by "can I talk to someone" is two episodes. | `shared/callTaxonomy.ts:389-398`; fixture: kernel 5 vs gap-based 4 | Inflated queue rows and a missed redial link, the exact thing the kernel exists to prevent. |
| 7 | **No recording or AI disclosure.** `FIRST_MESSAGE` is "Nick's Tire and Auto — what can I do for you?" while `artifactPlan.recordingEnabled: true`. | `vapi.ts:414, 1062` | Ohio one-party consent covers the shop's own line (EXT, ORC 2933.52). Out-of-state all-party callers and AI-disclosure expectations are the risk (EXT: Invoca 2026, 83% want AI to identify itself; Gartner 2026, 87% require a route to a human). |
| 8 | `human_pending` can close only by sending a text: `markNoReplyNeeded` and `smsOps.releaseTakeover` have no client caller. | `routers/smsConversations.ts:387`, `routers/smsOps.ts:307` | The 45-row queue cannot be honestly worked down; alerts fire on rows nobody can close. |
| 9 | The only writer of `customer_status_messages` (`dispatch.sendMessage` / `generateMessage`) has no client caller. There is **no status tool** for voice; status calls are transferred. | `routers/dispatch.ts:~250-285`; `vapi.ts:347` | Proactive "your car is ready" is BUILT and unreachable, so status calls land on the counter. |
| 10 | Three separate "car is ready" texts, one hard-coding "open until 6pm" (wrong on Sundays, 9–4). | `dropOffFlow.ts:193`, `workOrderService.ts:368`, `routers/booking.ts:710` | A wrong-hours text on Sundays; duplicate texts possible. |
| 11 | One Android SMS gateway phone; Twilio "dead since wave-103"; the consent gate is SHADOW by default. | `sms.ts:1213-1214, 1862-1900` | A single point of failure (offline ~18 h on 09-21/22). EXT: automated business traffic over a consumer SIM violates carrier terms (T-Mobile T&Cs; CTIA "non-consumer" definition) and is filtered silently. |
| 12 | `expected_arrivals` no-show = no invoice within 3 days, written for any walk-in suggestion. The no-show sweep uses a bare `CURDATE()`, which AGENTS.md forbids. | `expectedArrivals.ts:210, 366` | Measures the assistant, not the customer (§3). |
| 13 | The `callback-escalation` cron sets `no-answer` without anyone calling; the ">4 h" Telegram prints the full phone number. | `cron/jobs/crudAutomation.ts:212-229` | Callback outcome data is polluted, and a PII leak into chat. |
| 14 | `conversation_episodes` is written and **read by nothing**. Counter audio is captured during office hours. | `routes/conversationRoutes.ts:79`; no readers | EXT: Ohio protects an oral communication only where there is a justified expectation of privacy. Staff-party counter talk is likely fine; customers talking to each other are not. **OPERATOR:** signage and notice before install. |
| 15 | Photo assessment extracts no tire size or DOT code; there is no customer upload page; the flag defaults off. | `vision-analyzer.ts:70-75, 117` | A photo cannot yet replace "read me the numbers on the sidewall". |
| 16 | Four continuity stores and no per-phone context given to voice. `getCustomerJourneyTimeline` exists and is admin-only. | `smsOrchestrator.ts:1697`; `vapi-bdi.ts:71` (reachability depends on Vapi phone-number routing) | Nothing lets the assistant say "is this about the Camry from Tuesday?" |
| 17 | TiDB silently ignores `SELECT … FOR UPDATE SKIP LOCKED` (EXT: pingcap/tidb#69782, open, confirmed this session). **nickstire has no such usage** (REPO grep). | — | A guard for any future claim or queue code: compare-and-swap `UPDATE … WHERE state=?` checking affected rows = 1 (the repo's `claim-before-act`). |
| 18 | The memory counterfactual traced two reach paths and missed the receptionist-lesson path (A2). | `nickMemory.ts:254-278` | None today (source filter). Doc accuracy only. |

---

## Part D — Taxonomy, effort, obligations, trust

### §5. Taxonomy — adopt the one already built; do not invent

- **Use `VoiceIntent`** (39 values, `voiceDemandClassifier.ts:31-47`) as the one taxonomy for calls
  **and** texts.
- **Two known gaps to close in that module, not a new one:**
  - a `safety` rule ("wheel came off", "lug nuts", "no brakes") at priority 0;
  - spoken-number normalisation (`spokenNumbersToDigits` already exists in
    `shared/callDemandExtraction.ts:58`) before the size rules.
- **Spam** has no intent. It stays `unclear`, with `wrong_number` separate.
- **INFER:** the taxonomy the corpus will support at Nick's volume (~700–1,000 calls a month) is at
  most ~12 reportable families. The long tail should be counted but not charted.
- **EXP:** after the census runs, send only the `unclear` residue through a TnT-LLM-style pass
  (EXT: Microsoft, KDD 2024): summarise, propose labels, refine, freeze a version. Promote a new
  `VoiceIntent` only when a label holds at least 2% of episodes across two monthly runs.

### §6. Customer effort — keep the primitives; a composite index is not defensible yet

- **EXT.** The Customer Effort Score's founding evidence (Dixon et al., HBR 2010) was not
  peer-reviewed. de Haan et al. (2015, n = 6,649) found it predicted 2-year retention *worse* than
  satisfaction or NPS.
- **INFER.** At Nick's volume a weighted composite would move on noise and invite gaming. Report the
  raw primitives, each with its denominator. The census emits all of them.

| Primitive | Definition | Census field |
|---|---|---|
| Redial burden | Calls within 2 h of the previous call's end, same episode | `redials` |
| Channel switch | Episode has both a call and an inbound text | `multiChannel` |
| Repeated fact | Size or vehicle given in call *k*, asked again in call *k+1* | `reaskedKnownSize/Vehicle` |
| Self-reported repetition | "I already told you", "like I said" | `friction.repeated_self` |
| Not understood | "that's not what I said", "can you repeat" | `friction.not_understood` |
| Human bypass | First classified turn is `human_requested` | `openedWithHuman` |
| Handoff failure | Provider verdict `not_connected`, or a redial within 15 min of a forward (before 09-21) | `transferNotConnected`, `redials` |
| Promise without visible follow-up | Assistant promise, no delivered text or completed callback in 26 h | `promiseFollowedByContact` |
| Unanswered text | Last inbound text has no delivered reply | `unansweredInbound` |
| Time to first useful reply (texts) | Minutes to the first delivered outbound after the first inbound | `firstReplyMin` |

**Falsifier for adding a composite later:** if any two primitives correlate above 0.8 across
episodes, report one. If none of them predicts a 14-day invoice or a 90-day return better than
chance on a held-out month, no index is justified.

### §7. Obligations — extend the Promise Ledger; do not build a kernel

- **Lifecycle overlap, REPO + CORPUS·prior:**
  - `callback_requests`: 31 rows, no due column.
  - `sms_response_jobs`: has a 30-minute SLA constant.
  - `customer_promises`: due, kept-with-evidence, missed.
  - `emergency_requests`: 3 open for 158–178 d.
  - Rack checks: *no row at all*.
- **What they share:** subject phone, promised action, owner, due, closed-with-evidence.
- **The QUEUE-CENSUS verdict ("not before each queue has a drain") is right, but incomplete.** The
  generalisation already exists: `customer_promises` is the kernel. What is missing is
  **writers** (Part C #1–#3) and **close paths** (Part C #8).
- **Recommendation:**
  1. Every spoken or written commitment calls one helper that writes a `customer_promises` row:
     callback, rack check, "we'll text when done", and "someone will follow up". The helper
     generalises `createVoicePromise`.
  2. `sms_response_jobs.human_pending` rows get a promise row whose `due_at` is the next
     business-hours 30 minutes.
  3. "Kept" only on **outcome evidence** (a delivered text, an inbound reply, or a completed call on
     the promised number), never on an attempt. The ledger row `promise-auto-keep` already states
     this rule.
  4. The sweep never texts the customer on its own. It surfaces the miss to a human (the existing
     Decision Inbox).
- **Falsifier:** if a month of census output shows promises in fewer than 3% of episodes, the
  ledger is over-engineering for Nick. Keep only callbacks.

### §8. Customer-visible proof — where it helps and where it is clutter

| Request | Show the customer | Evidence it helps |
|---|---|---|
| Rack check | "Checked 2:14 pm — 2 × 225/65R17 used on the rack, $60 each installed (quote), held until 5 pm" plus an optional rack photo | EXT: J.D. Power ASI 2025, 41% vs 17% approval with photo or video (repairs, not tires; survey-reported). INFER: removes the "drive over for nothing" risk. |
| Callback | The promised window and, if it is missed, an automatic "still on it, sorry — [name] will call by X" | EXT: McCollough 2000 — recovery does not restore pre-failure satisfaction, so prevent the miss. Delay announcements lower waiting cost (Yu, Allon & Bassamboo 2017). |
| Status of a car at the shop | Stage and next step by text on request | EXT: 56% of tire and quick-lube customers prefer texted updates (J.D. Power ASI 2025). |
| Estimate or approval | Line items, photo, and a timestamped approval (`/inspection/:token` exists) | EXT: OAC 109:4-3-13 requires authorisation for work above the estimate; a timestamped digital approval is defensible evidence. |
| Receipt or warranty | Link on request (`/portal` has invoices; **no warranty data**) | INFER: low frequency; build only if the census shows ≥1% of episodes. |
| Every call | **Not** a recap text after every call | Clutter, plus gateway load. Recap only when a fact was captured or a promise made. |

---

## Part E — Voice, SMS, economics

### §9. Voice and SMS quality — fix measured failures; do not migrate providers

- **EXT (confirmed this session).** τ-Voice (arXiv 2603.13686, 2026-03-14): the best voice agents
  complete 31–51% of grounded tasks on clean audio and 26–38% with realistic noise and accents,
  against 85% for text. 79–90% of failures are agent behaviour, not audio.
  **INFER:** Nick's highest-value voice work is behavioural — what the agent promises and captures —
  not ASR vendor choice.
- **Entity capture.** Tire sizes spoken digit by digit ("two two five fifty r 18") are a measured
  miss (`tire-size-recall.mjs:13-17`). The size exists in only 3 of 11 tire calls (09-22).
  **Recommendation:**
  1. Read back and confirm: "225, 65, R17 — right?"
  2. Offer a text link for a sidewall or door-jamb photo.
  3. Stop hoping the regex hears it.
  Vapi structured outputs (EXT, docs) can replace post-call regex extraction for size, quantity,
  vehicle and promised action. Shadow it against `extractDemand` first.
- **Barge-in, silence and latency.** The measured p90 reply gap of 2.29 s is above the ~1.1 s
  cascaded-agent target (EXT: Twilio 2025) and well above the ~200 ms human baseline (EXT: Stivers
  2009). "Hello? Hello?" as the top opener points at connect latency or first-audio issues. Do not
  change the provider. Measure first-audio time on the calls whose first customer turn is "hello?".
- **Warm transfer.** 11 of 11 connected is n = 11. The runbook's ring-out canary has not run, and
  `transfer-update` events are subscribed but unhandled (REPO `vapi.ts:1019`). Handle the event and
  run the canary before calling transfer "proven".
- **Regression evals.** Use Vapi Evals / Test Suites (EXT, docs; already paid for) for tool-call
  assertions, plus promptfoo (MIT; OpenAI-owned since 2026-03, still MIT) over de-identified,
  human-approved cases mined from `vapi_call_archives`. Do not adopt Langfuse self-hosted (four
  datastores) or Phoenix (ELv2).
- **SMS.** The single point of failure is physical (a phone). **OPERATOR** options:
  1. Keep the phone, add a health-to-page loop (exists) and cap automated volume.
  2. Register a 10DLC brand and campaign on a carrier API for automated lanes, and keep the phone
     for human-typed conversation.

  **INFER:** option 2 is the only one that is both compliant and has a fallback. It costs
  registration fees and roughly 2–4 weeks.

### §10. Economics — formulas and experiments, not ROI claims

**Definitions** (all per episode; the census computes the inputs):

- **Linked revenue** = Σ invoice totals, same phone, within 14 d of episode start. *Correlation only.*
- **Influenced** = linked, and the episode had a captured fact or a kept promise.
- **Recovered** = linked, after a recovery action (callback, text) on an episode that had no next
  step.
- **Incremental** = measurable **only** by experiment:
  Δ(linked rate, treatment − control) × median linked ticket × treated episodes.
  Report with a permutation-test p-value.
- **Staff interruption load** = connected transfers × median handle time + callbacks completed ×
  median callback duration.
- **Base rates to hold every claim against (CORPUS·prior):**
  - ~700–1,000 inbound calls a month against ~105–145 paid invoices a month.
  - 77% one-and-done customers.
  - **INFER:** most calls are not new revenue. A lever that "saves 10% of lost calls" is worth at
    most 10% × (qualified share, unknown until the census) × conversion × ticket.

**Experiment designs.** Customers cannot be cleanly randomised at a one-location FCFS shop, so use
switchbacks (EXT: Bojinov, Simchi-Levi & Zhao, Management Science 2023): randomise treatment by
half-day block and test with block permutation.

| Experiment | Unit | Primary metric | Guardrail |
|---|---|---|---|
| Rack-check result by text vs "come on by" | half-day | arrival (invoice ≤ 3 d) among rack-check episodes | staff minutes per check |
| "What we heard" recap text after tire calls with a captured size | half-day | redial ≤ 24 h; correction replies | opt-outs |
| Greeting with recording + AI disclosure | alternating days | hang-up in the first 10 s | human-request rate |

---

## Part F — What customers teach us, and what we are teaching them

### §11. What customers are actually teaching us

1. **A quarter of callers want a person before anything else, and getting one fast is success.**
   94.7% are forwarded within a median of 2 turns (CORPUS·prior). A "reduce transfers" goal would
   optimise against customers.
2. **Price, not stock, is the first blocker.** Price uncertainty is 32% of first-turn friction
   (CORPUS·prior), and the assistant is told never to speak to stock. **Contradiction:** the
   architecture is tire-inventory-first while the customer's first question is "how much".
3. **Callers are terse and the line is noisy.** Half of turns are 3 words or fewer; "Hello? Hello?"
   leads. Designs that need long spoken answers (sizes, VINs, addresses) fight the channel. A photo
   or text link is the fit.
4. **"I'll come by" is usually the assistant's phrase, not the customer's commitment.** 66 of 89
   no-shows never named a day (CORPUS·prior).
5. **Customers text rarely, and when they do we answer late.** 43 inbound texts in 30 d; 74% not
   answered within 2 h (July). EXT says 56% of tire customers *prefer* texted updates.
   **Contradiction to test:** low inbound SMS may reflect that we never invite it and answer it
   slowly, not low preference.
6. **Before warm transfer, about a quarter of forwarded callers called back within 15 minutes.**
   That is the clearest measured friction in the data. Warm transfer (09-21) may have fixed it
   (n = 11).

### §12. What the shop is accidentally training customers to do (each with its evidence grade)

| Trained behaviour | Evidence | Grade |
|---|---|---|
| **Redial** after a transfer | 22–28% forward → redial within 15 min (before 09-21) | CORPUS·prior (measured) |
| **Ask for a person first** | The AI cannot answer price with confidence (§11.2) or stock (`checkTireStock` only hands off), so bypassing it is rational | INFER (the two inputs are measured; causation is not) |
| **Repeat the tire size** | Part C #1: "sent to the shop" persists nothing | REPO mechanism; frequency **unmeasured** until the census's `reaskedKnownSize` runs |
| **Call for status** | No status tool, the proactive status writer is unwired, and status calls are transferred | REPO mechanism; `active_job_status` share unmeasured |
| **Not bother texting** | 74% unanswered within 2 h; 45 pending, 27 over 30 d | CORPUS·prior + INFER |

---

## Part G — The lists

### §13a. Ten upgrades customers would notice immediately

1. **Rack check with a result by text.** Capture a promise row, give staff a one-tap "checked:
   yes / no / qty / price" in admin, and have `orchestrateSms` send the result with its timestamp.
   Builds on `checkTireStock`, `promiseLedger`, `orchestrateSms`.
2. **"What we heard" recap** after a call that captured a size or vehicle, with "reply to correct"
   (correction without restart). Builds on `sendConfirmationSms` and `extractDemand`. This makes
   Part C #1 true.
3. **Honest callback window** ("a person will call by 2:30") backed by a tracked obligation, and an
   automatic apology-and-reschedule to the *customer* only when a human has approved the template.
4. **Status by text on request.** Wire `dispatch.generateMessage` / `sendMessage` into the work-order
   screen, and add a voice `jobStatus` tool that reads the same work order (`/track` exists).
5. **Sidewall or door-jamb photo link** in the recap text. Photo-assess extracts size plus a DOT
   `WWYY` check with validators (§13b #9).
6. **Recording and AI disclosure** in the greeting: one sentence (OPERATOR copy decision).
7. **Returning-caller context:** "Is this about the 2015 Camry?" only when the phone matches exactly
   one customer, with the vehicle drawn from invoices. `vapi-bdi.ts` exists; verify it is reachable.
8. **After-hours capture that promises nothing false:** "we open 8 (9 Sun); reply with your size and
   we'll have a quote waiting". The `after_hours_capture` orchestration type exists.
9. **Correct hours in every "car is ready" text** (Part C #10), collapsed to one sender.
10. **A human reply to every waiting text**, or an explicit "no reply needed" close (Part C #8). The
    customer notices when the 45th text is answered.

### §13b. Ten backend and operator upgrades customers will feel

1. Wire `classifyVoiceDemand` into the `vapi-eval` cron in shadow (store it beside `intents`),
   compare for 14 days, then switch. Add the safety rule and spoken-size normalisation first.
2. Gap-based episodes in `recoveryQueue.ts`, keyed on phone only, with intent kept as an attribute.
3. `tireInquiry` persists its demand to `vapi_call_logs.metadata.demand` (the field already exists
   and is read by `tire-size-recall`) and a counter card shows it. No lead row, so no feed noise.
4. Delete the "promised 15 min callback" text (`vapi.ts:627`) and the unregistered
   `scheduleCallback` / `quoteRange` dispatch and auditor branches.
5. A UI caller for `markNoReplyNeeded` and `releaseTakeover`.
6. One obligation-writer helper over `customer_promises` (§7), with outcome-evidence keeping.
7. A `transfer-update` handler plus the ring-out canary for warm transfer.
8. A mask-first PII rule: one `maskPhone` (there are three or more today) and a fix for the
   full-phone Telegram (Part C #13).
9. Photo-assess returns `{size, loadIndex, speedRating, dotWeekYear}` through the gateway with a
   strict JSON schema, plus regex and date validators. NHTSA vPIC VIN decode (EXT, public, no key)
   for vehicle.
10. SMS lane split: automated lanes on a registered carrier API, conversation on the phone
    (OPERATOR, cost).

### §13c. Ten things not to build

1. A new CRM or timeline store. There are four continuity stores already; expose
   `getCustomerJourneyTimeline`.
2. A graph database or embeddings memory for customers.
3. A composite Customer Effort Index (§6).
4. A voice provider migration. τ-Voice says the gap is behavioural.
5. Another dashboard. The 1,118-row queue lesson.
6. Proactive marketing blasts over the Android gateway. It is a carrier-terms risk and has no
   fallback.
7. LLM summaries of counter audio before notice and signage exist, and before coverage stays above
   65% for a week.
8. "My Garage" expansion. `customer_vehicles` is keyed to portal users, not phones.
9. Re-enabling automated voice recovery dialing before the promise and consent path exists (110 of
   110 failed silently).
10. First-snow predictive stocking or a fleet program: no Nick data supports either yet. Revisit if
    the census shows a seasonal tire-share jump or commercial callers above 2%.

### §13d. Ten odd but plausible experiments (EXP)

1. **Keypad capture of tire size:** "type the numbers on your sidewall" (DTMF) versus speech;
   measure capture rate.
2. **Rack photo:** staff snap the actual tire and the text carries it; switchback against text-only.
3. **Batched rack-check missions:** one walk every 30 minutes for all pending checks versus
   on-demand; staff minutes against customer wait.
4. **"On my way" text** for FCFS: the customer replies with an ETA and the counter strip shows it;
   measure arrival vs no-show.
5. **Callback-time choice:** "now, 30 minutes, or after 5?" Measure answered callbacks.
6. **Human-first answering 10 am–2 pm** versus AI-first (switchback). Does AI-first cost arrivals?
7. **Customer-side promise audit:** a one-tap "did we do what we said?" two days after a promise.
8. **Price-range first:** answer "how much for two used 17s" with a range before transfer; measure
   human-request rate and arrivals.
9. **Greeting variant** that invites text ("or text this number anytime"); measure inbound SMS share.
10. **Door-jamb placard photo** as the default size path for callers who do not know their size.

---

## Part H — Map every recommendation to what exists

| Recommendation | Action | Builds on | Problem · Nick evidence · External | Acceptance test | Live proof required | Metric · kill switch · falsifier |
|---|---|---|---|---|---|---|
| Stop the false "sent to the shop" | **MODIFY** | `voiceAgent.ts:628-644`, `vapi_call_logs.metadata.demand` | Part C #1 · repeat burden · Zendesk 2026: 74% frustrated repeating (vendor) | A unit test: an ordinary inquiry writes demand to metadata; the message text is unchanged or truthful | A production call row with `metadata.demand.tireSize` from `tireInquiry` | `reaskedKnownSize` ↓ · revert commit · falsifier: re-ask rate already < 2% of multi-call episodes |
| Remove the untracked 15-min promise | **DELETE** | `vapi.ts:627` | Part C #2 · prompt contradiction | Tool-schema snapshot test that has no "promised" text | The Vapi assistant config after push carries the new description | Assistant promise count (census) · revert · — |
| Obligation writer | **CONSOLIDATE** into `customer_promises` | `promiseLedger.ts:310`, `escalate`, `sms_response_jobs` | §7 · 0 rows · McCollough 2000 | A promise per commitment kind; kept only with evidence | A non-zero `customer_promises` row from voice, kept by evidence | kept / (kept + missed) · flag `promise_writer_enabled` · falsifier: < 3% of episodes carry a promise |
| Wire `classifyVoiceDemand` | **MODIFY** (wire) | `voiceDemandClassifier.ts`, `vapiCallEval.ts` | Part C #4/#5 | Shadow field written; parity test against the fixture | 14 days of shadow rows in production; disagreement table from the census | `unclear` share, tire share · shadow-only · falsifier: disagreement < 5% |
| Gap episodes | **MODIFY** | `callTaxonomy.ts:389` | Part C #6 | `customerCorpus.test.ts` case moved to the kernel | Queue episode count vs census call episodes | rows per customer · revert · falsifier: kernel and gap counts within 2% |
| Close path for texts | **MODIFY** (wire UI) | `markNoReplyNeeded`, `SmsOrchestratorSection.tsx` | Part C #8 · 45 pending | RTL test: the button calls the procedure; two-tap confirm (iOS PWA rule) | `human_pending` count reaches ≤ 5, none > 7 d | median age · — · — |
| Rack-check result text | **NEW** (thin) | `checkTireStock`, promises, `orchestrateSms` | §8 · price and stock blockers · J.D. Power photo effect | Admin "checked" action writes evidence and a draft text | 10 production rack checks closed with a sent result | arrival ≤ 3 d (switchback) · flag · falsifier: no arrival lift after 60 blocks |
| Status on request | **MODIFY** (wire) | `dispatch.sendMessage`, `/track` | Part C #9 · J.D. Power 56% prefer text | UI caller test | 5 status texts sent from the work-order screen | status calls ↓ (census `active_job_status`) · flag · falsifier: status calls < 2% of episodes |
| Disclosure line | **MODIFY** (copy) | `FIRST_MESSAGE` | Part C #7 · Invoca/Gartner 2026 | Snapshot test on the greeting | Pushed config | 10-second hang-up rate · revert · — |
| SMS lane split | **NEW** (vendor) | `sms.ts` provider switch | Part C #11 · CTIA/T-Mobile terms | Provider routing test | 10DLC campaign approved | delivered / sent · env · — |
| Promote the census rules to invariants | **NEW** tests | cron runner, status tables | A3 | Canary tests break, then pass | CI green | — |
| Provenance model | **PARK** | — | A1 | — | — | — |

**Owners:** code rows belong to the agent. OPERATOR rows are copy, vendor, signage and the one
census run.

**Privacy and compliance on every row:**
- no raw transcript leaves the database;
- excerpts are masked and never committed;
- a promise text follows the quiet-hours rule in `sms.ts:323-328`;
- opt-out is checked in the send path (already the case).

---

## Part I — Next repo investigations, in dependency order (continuous; stop only at a gate)

1. **OPERATOR GATE:** run the census over 06-22 → 09-22 and 07-23 → 09-22 (`--json`). Nothing
   below the line is ranked until it runs.
2. Read the census coverage table. If archive completeness is below 90% in any week after 07-23,
   fix `vapiCallArchive` first (the 500-per-run cap and 14-day horizon mean a stall longer than 14
   days loses calls for good).
3. Wire the `markNoReplyNeeded` / `releaseTakeover` UI (no dependency).
4. Delete the "promised 15 min callback" tool text and the dead dispatch branches (no dependency;
   a Vapi config push is an OPERATOR click).
5. `tireInquiry` → `metadata.demand` persistence plus a counter card (depends on nothing; measured
   by the census's `reaskedKnownSize`).
6. Add the safety rule and spoken-size normalisation to `voiceDemandClassifier`, then shadow-wire it
   into `vapi-eval` (depends on 1 for the baseline).
7. Gap-based episodes in `recoveryQueue` (depends on 6 for family attributes).
8. One obligation-writer helper plus outcome-evidence keeping (depends on 3 and 4).
9. Rack-check result flow (depends on 8).
10. Status on request (depends on 8 for the promise when a status is owed later).
11. `transfer-update` handler plus the warm-transfer canary (independent; the canary is an OPERATOR
    test call).
12. Promote the census rules to invariants (A3).
13. Photo-assess structured size extraction (depends on the operator enabling
    `photo_assess_enabled`).
14. Re-run the census monthly. Compare the primitives, and kill any item whose falsifier fired.

---

## Part J — Paste-ready directive for the next Claude session

```
You are continuing Nick's Tire customer-operations work in apps/nickstire. Standing rules:

1. Ladder: BUILT ≠ WIRED ≠ TESTED ≠ DEPLOYED ≠ LIVE-OBSERVED ≠ OUTCOME-PROVEN. Merged or deployed is
   never "working". Claim a rung only with its receipt (test summary line, production row, log line).
2. Never invent production evidence. If you cannot read production, say so in sentence one, and hand
   the operator the exact read-only command (pattern: railway run -s MAINnicks-tire-auto -- pnpm diag:*).
   Never print or request secrets to get access.
3. Customer corpus: use `pnpm diag:customer-corpus` (scripts/diagnostics/customer-corpus-census.mts).
   Aggregate or masked output only; never commit --excerpts output; never paste a transcript line.
4. Prefer wiring, completing or deleting over new architecture. Before any new table, queue, tool,
   flag or taxonomy, run the prior-art-grep skill. Known built-but-unwired: classifyVoiceDemand,
   markNoReplyNeeded, releaseTakeover, dispatch.sendMessage, conversation_episodes readers.
5. Work the list in docs/operations/CUSTOMER-CORPUS-RESEARCH-2026-09-23.md Part I, top to bottom,
   inspect → fix → test (positive control first) → verify (nickstire-verify skill) → PR →
   live-observe → update truth docs. Continue to the next item without asking.
6. Stop only at an operator gate: customer-facing copy or sends, Vapi config pushes, production
   writes, vendor or spend decisions, signage or consent — or when told STOP. At a gate, finish
   everything that does not depend on it, and give the operator one exact action.
7. OSS: borrow mechanisms from permissive licences (MIT/Apache/BSD). Never embed AGPL, SSPL, BSL,
   ELv2 or unlicensed code (Unleash server, Emmett, Inngest server, Restate, Phoenix, Twenty).
   TiDB silently ignores SKIP LOCKED: claims are compare-and-swap UPDATEs checking affected rows = 1.
8. Privacy: mask before match, match before print; phones as hashes in any artifact; no PII in logs
   or Telegram.
9. Report with receipts: files, tests (N passed, exit 0), PR link, what is DONE / BLOCKED-ON-X /
   NOT-STARTED.
```
