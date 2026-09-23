# Nick's customers · what three months of calls and texts can and cannot tell us (2026-09-23)

**Answer first.**

1. **This session did not read the production corpus.** There was no database credential in the
   container. The only route to one was the Railway variable listing, which prints every production
   secret in plaintext into the transcript, and that exposure was judged not worth it. The Neon
   (statenour) database holds no call or SMS corpus (I checked the table list). So this document
   contains **zero new customer-corpus facts**. It contains:
   - about 40 dated production measurements from earlier sessions, each labelled as such;
   - 38 findings verified in code this session (Part C), 18 of them fixed in this PR — most after
     three independent reviews of the first draft found what its author had missed;
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
   - The assistant told tire callers "I've sent the tire info to the shop" when nothing but the
     call log is stored, and a tool description told the model to promise a "15 min callback" that
     nothing tracks. Both are **fixed in this PR**, with every other untracked callback promise the
     review found (Part C "Shipped"). The tool replies are live on deploy; the receptionist's prompt
     and tool text only after the operator presses Push Latest Config.
   - 45 `human_pending` text rows wait on a human: about 34 are customers (6 are carrier bounces, ~5
     vendor spam), and 25–27 are older than 30 days (two sources disagree). A reply typed on the
     gateway phone does not close a row, so 45 is an upper bound. The only way to close one is to
     send a text, because the "no reply needed" procedure has no UI caller.
   - One Android phone is the path for about 80% of customer-facing text *flows* (a count of flows,
     not of volume), with no fallback. At 09-22 21:12Z it had been offline 20.6 h and was still
     offline when measured; the outage had been intermittent since 09-21 02:05Z.
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
| **REPO** | Verified repo fact: read in code this session (`origin/main` d72823e at the start, this PR's branch after) |
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
| `CRON-OUTCOME-CENSUS` | MEASURED, with a reproduce command | **High**: the SMS gateway incident (a 16-line section among many) | KEEP. The gateway finding deserved its own incident row, a fallback decision, and a customer-impact count: how many customer texts were queued or held, and how many were delayed past their usefulness. |
| `QUEUE-CENSUS` + `orchestration-status-reconcile` | MEASURED. The reconcile job is BUILT and TESTED; no live-run receipt was found this session. | **High**: 45 customers waiting on a reply, 3 emergency rows, a 308-row status lie | KEEP. Its "operator decides #1" is **partly a code gap, not only a staffing gap**. `smsConversations.markNoReplyNeeded` (`server/routers/smsConversations.ts:387`) has no client caller (REPO, grep: zero hits in `client/src`). A `human_pending` row can only close by sending the customer a text, so the queue *cannot* be drained honestly. Wire the button before asking a human to drain it. |
| `CRON-INVENTORY.md` regenerated | Generated artifact | None | KEEP. It is generated, so it is not a finding. |

### A2. The memory work barely reaches customers — and the doc missed its one route to them

- **REPO.** Nick's memory reaches the *customer-facing* receptionist through one path:
  - `updateAssistant()` → `getPromptLessons()` (`server/services/vapi.ts:1660-1667`,
    `server/services/nickMemory.ts:263-278`) appends the top 3 `lesson` rows to the Vapi system
    prompt.
  - This happens only on the operator's manual "Push Latest Config". That push sends the WHOLE
    `buildAssistantConfig` (every prompt, tool and voice change on `main` from any session, not one
    PR's lines), appends up to 3 auto-selected lessons that nobody reviews in that flow (the panel
    previews them), and overwrites dashboard edits except the transfer tool. A second path,
    `scripts/vapi-update-assistant.ts`, sends no lessons and forces `sipVerb: "dial"`. Run
    `scripts/vapi-prompt-diff.ts` first to see what will change.
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
| "capability-ledger-updated satisfied by ledger diff" | **PROMOTE to a gate fix, then DELETE the memory** | Satisfying the rule with a ledger diff is by design (`satisfiedByDiff`). The real defect was found in this PR: `dod-compiler.mjs` judges an evidence entry "fresh" by comparing it with the **tip** of the base branch (`git show origin/main:…`), not the merge base. When `main` moves on and rewrites an entry, a branch still carrying the old entry reads as fresh. Locally this PR passed on exactly that; CI (which merges `main` first) then called it STALE, correctly. Fix: compare against `git merge-base`. Separately, the output quotes the manifest entry's text even when the ledger diff is what satisfied the rule, which reads like "passed on an unrelated entry". |
| "bare squash merge drops co-author trailer" | **PROMOTE to a script check** | `gh pr merge --squash` without `--body` is a mechanical rule. A merge helper, or a CI check on the squash commit, enforces it; a memory only hopes. |
| "git add aborts on one bad pathspec" | **DELETE** | Generic git behaviour; costs index space. |
| "TaskStop kills wrapper not tree", "Railway CLI rate limiting + ledger render check" | KEEP | Real, non-obvious harness traps. |
| The three extended memories (store verdict, hourly tier, join-key proxy) | KEEP | Extending beats duplicating. |
| `.remember/now.md` | **DEMOTE history** | 1,276 lines. A handoff is read at session start; everything older than the last two waves belongs in a dated archive file. Its value is the top 60 lines. |
| "Completed + 0 must say what it examined" (census rule) | **PROMOTE to an executable invariant** | A test over every registered cron's zero-record `details` string: it fails when a zero-record run has no denominator or reason. #2514 started this and fixed three of the five jobs the census named; two remain silent. |
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
`capability-ledger.json` (`voice-demand-speaker-attribution`, `voice-transfer-connect-truth`), `server/services/vapiCallArchive.ts:26-28`.

**SMS coverage caveats (CORPUS·prior):**
- May 2026 failures dominate `sms_messages` (5,184 of 5,346).
- Opt-out records start only 2026-07-13; earlier STOPs were dropped.
- `sms_response_jobs` and `expected_arrivals` were missing in production 07-21 → 07-26.
- Operator replies wrote two rows until 2026-09-01 (`skipPersist`); older rows double-count them.
- The 308 orchestration rows stuck at `queued` (fixed by the reconcile job going forward).

### §3. What earlier production reads already established (CORPUS·prior)

| Fact | Value | Date · source |
|---|---|---|
| All calls (no inbound/outbound split was applied) | 2,094 in 90 d (~23/day); 986 in 30 d (~33/day) | 07-26 · `vapi_call_logs` (MIX) |
| Forwarded to a human (`assistant-forwarded-call`) | 40.3% (843/2,094); 41.5% on 08-05 | 07-26 · 08-05 |
| Callers whose **first substantive words** ask for a person | 20.9% (conservative) – 24.9% (classifier), n = 363 | 07-26 · customer turns |
| …of those, forwarded promptly | 94.7% (72/76); median 2 customer turns before the forward | 07-26 |
| First-turn demand (n = 363, deterministic tier) | human 24.9% · generic tire 16.1% · brakes 5.2% · used-tire price 2.7% · oil 2.5% · **unclear 34.2%** | 07-26 |
| Blocking friction on the first turn — **a label, not a measurement**: the classifier attaches `price_uncertainty` by rule to 15 service intents (`voiceDemandClassifier.ts:143-224`), so this restates the intent mix | price uncertainty 32.0% · human required 24.9% (= the `human_requested` share) · transportation 2.7% · unknown 35.5% | 07-26 |
| Forward then redial within 15 min | 28% (280/1,016, 90 d); 22% (48/214, 14 d); 24% (57/240, 14 d, ~09-18) | 08-05 · 09-18 |
| Warm transfer (experimental plan, live since 09-21 13:57Z) | 11 of 11 forwards `connected`; fallback never fired; **n = 11** | 09-22 |
| Very short turns | 50% of 1,460 turns were 3 words or fewer; 16.4% hesitation stubs. Two or more bare "Hello?" in 0.7% of calls; the barge-in and first-audio theories were refuted by measurement (first assistant audio 0.41 s avg, 0.64 s max) | 08-07 · `stt-forensics.ts:24`, `docs/skill-proposals.md:533-540` |
| Calls with fewer than 2 caller turns | 18% (89/492) | 08-08 |
| Assistant latency | Time to first audio p50 0.40 s; reply gap p50 0.90 s, p90 2.29 s | 07-27, n = 100 |
| Inbound texts | 43 in 30 d (09-22); 58 customer turns in 180 d (07-25) | ledger · ROS-058 |
| Texts unanswered within 2 h | **74%**, including 10 opt-outs; automated reply p50 6 s against operator reply p50 4.5 min. ROS-058: "mostly pre-orchestrator era" — it cannot support "we answer late" today | 180 d to 07-25 |
| Texts waiting on a human | 45 `human_pending`: 25–27 over 30 d; 6 are carrier bounces, ~5 vendor spam | 09-22 |
| Expected arrivals, 30 d | 116 written (all voice): 15 arrived · 89 no-show · 12 open. **66 of the 89 never named a day; 63 were price or inquiry calls** | 09-22 |
| Promise ledger | `customer_promises` = **0 rows**. Expected, and silent about customers: the only live voice writer (`escalate` → `createVoicePromise`, with a call ID) shipped 09-22 with no live run yet | 09-22 |
| Voice recovery | 110 of 110 dials failed with a 400 error (06-18 → 09-20) | 09-22 |
| Invoices | ~105–145 paid per month (older, CT:293); **73 in the 30 d to 09-22** (latest, now.md) | CT:293 · now.md |
| One-and-done customers | 77% ("VERIFIED 2026-07-19"; source query not located) | `data-census.ts:50` |

**INFER — the cross-examination these numbers demand.**

1. **"Tire-first is not supported by caller speech" (MIX addendum) overreaches.** It is a
   *first-turn* measurement, and a quarter of first turns are "get me a person", which hides the
   need. The census's `episodeNeed` reads every turn, so the real tire share is still unknown. It
   is somewhere between 16% (generic tire, first turn) and a much larger number once human-first
   callers' later turns are read.
2. **"Forwarded" was never "connected" before 09-21.** Every transfer-success figure before the
   warm-transfer plan is an attempt count. The 22–28% 15-minute redial rate is the best proxy for
   failed handoffs in that period.
3. **The arrivals kernel mostly measures the assistant, not the customer.** `bookSlot` fires for any
   non-tire walk-in lead, and alongside a non-tire transfer once a phone is captured (the prompt's
   PHONE-CAPTURE-BEFORE-TRANSFER; the `shared/callTaxonomy.ts:275-279` comment says the same), so
   "no-show" means "no invoice". The honest reading of 15 arrived out of 116 is a lead-to-invoice
   rate, not a broken-commitment rate.

### §4. The instrument (built this session; the operator's one gate is running it)

`pnpm diag:customer-corpus` — `scripts/diagnostics/customer-corpus-census.mts` plus the pure
library `scripts/lib/customerCorpus.ts`.

- **Read-only.** Every statement is a SELECT. It reads `vapi_call_logs`, `vapi_call_archives`,
  `sms_messages`, `sms_conversations`, `callback_requests`, `expected_arrivals`,
  `sms_response_jobs`, `customer_promises`, `revenue_opportunities` and `invoices`.
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
- **Also (added after the operator's steering, Part K):** recontact ≥10 minutes, link confidence
  (single / consistent / ambiguous), transfer-failure incidents, opportunity rows, and `--export`.
- **Privacy:**
  - Phones become a salted hash: per-run by default, or stable via `CORPUS_ANALYSIS_SALT`.
  - Customer text is masked **before** classification (Part C #19).
  - `--excerpts N` prints only masked windows of at most ~15 words, and `maskPII` runs before any
    match.
  - `--json` is aggregate-only.
  - **Known masking limit:** a name that is not introduced ("my name is…", "this is…") survives
    masking. Treat `--excerpts` output as sensitive and do not commit it.
- **Proof it measures something:**
  - `scripts/lib/customerCorpus.test.ts`: 27 tests, including three positive controls that pin
    defects in existing code (no intent for a bare tire request, the 8 PM episode split, a phone
    number read as a tire size).
  - `scripts/diagnostics/customerCorpusCensus.fixture.test.ts`: 12 tests running the real runner
    end-to-end on a synthetic fixture. That includes an export refused inside the repo, and an
    export with a real and a spoken phone number in a text body that must come out masked.
  - Mutation checks:
    - breaking sessionization reddened 3 tests;
    - dropping phone masking reddened 2;
    - narrowing the tire pattern reddened 1;
    - counting failed texts as follow-up reddened 1;
    - un-masking the export body reddened 1.

**What the census still cannot see (operator-side exports if these matter):**
1. The audio. Accent, noise and ASR errors need `recording_url` while it is live, or Vapi
   stereo recordings copied to our own bucket. Vapi retention (EXT, Vapi pricing docs) is 14 days on
   Build / pay-as-you-go and 30 on Core, with a paid 60-day add-on, so the plan tier matters.
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
| 3 | The CALLBACK CAPTURE prompt section says "I'll send this to the shop so someone can follow up" and routes to `sendConfirmationSms`, not `escalate`. Only `escalate` and `scheduleCallback` write a promise. | `vapi.ts` CALLBACK CAPTURE section; `voiceAgent.ts:337-360` | A spoken follow-up promise with no obligation row. (Only `escalate` writes a promise from a live call; `scheduleCallback` does too but is not in `VAPI_TOOLS`.) **Fixed in this PR** (#22). |
| 4 | `detectIntents` (the live eval classifier) has **no pattern for a bare tire request**: "I need two tires for my Honda", "do you guys have tires" and "I need a tire" all give `[]`. It also misses a spoken size ("two two five sixty five seventeen"). | `server/services/vapiCallClassifier.ts:31-54`; pinned by a positive control in `customerCorpus.test.ts` | Plain tire buyers land in `unknown` / `unclassified`. Tire-share figures are biased both ways: before 09-18 the classifier read the assistant's own words (inflating tire share); since then bare tire requests get no intent (deflating it). |
| 5 | `voiceDemandClassifier.ts` reads those phrases correctly (`tire_service`), has `rack_check`, `active_job_status` and a friction taxonomy, and is **imported by no production path** (only its own test and this census). It misses "the wheel came off" (tire_service, not safety) and spoken sizes. | `grep classifyVoiceDemand`: one test file | BUILT + TESTED + UNWIRED: the doctrine's prime target. |
| 6 | `episodeKey` buckets by fixed UTC day (boundary 8 PM EDT / 7 PM EST) **and** keys on intent family. A tire call followed 40 minutes later by "can I talk to someone" is two episodes. | `shared/callTaxonomy.ts:389-398`; fixture: kernel 5 vs gap-based 4 | Inflated queue rows and a missed redial link, the exact thing the kernel exists to prevent. |
| 7 | **No recording disclosure, and AI is disclosed only when asked.** `FIRST_MESSAGE` is "Nick's Tire and Auto — what can I do for you?" while `artifactPlan.recordingEnabled: true`; the prompt's COMPLIANCE NOTE admits AI only to a direct question. | `vapi.ts:414, 1062` | Ohio one-party consent covers the shop's own line (EXT, ORC 2933.52). Out-of-state all-party callers and AI-disclosure expectations are the risk (EXT: Invoca 2026, 83% want AI to identify itself; Gartner 2026, 87% require a route to a human). |
| 8 | `human_pending` can close only by sending a text: `markNoReplyNeeded` and `smsOps.releaseTakeover` have no client caller. | `routers/smsConversations.ts:387`, `routers/smsOps.ts:307` | The 45-row queue cannot be honestly worked down; alerts fire on rows nobody can close. |
| 9 | The only writer of `customer_status_messages` (`dispatch.sendMessage` / `generateMessage`) has no client caller. There is **no status tool** for voice; status calls are transferred. | `routers/dispatch.ts:~250-285`; `vapi.ts:347` | Proactive "your car is ready" is BUILT and unreachable, so status calls land on the counter. |
| 10 | Three separate "car is ready" texts, one hard-coding "open until 6pm" (wrong on Sundays, 9–4). | `dropOffFlow.ts:193`, `workOrderService.ts:368`, `routers/booking.ts:710` | A wrong-hours text on Sundays; duplicate texts possible. |
| 11 | One Android SMS gateway phone; Twilio "dead since wave-103"; the consent gate is SHADOW by default. | `sms.ts:1213-1214, 1862-1900` | A single point of failure (offline 20.6 h and counting at 09-22 21:12Z). EXT: automated business traffic over a consumer SIM violates carrier terms (T-Mobile T&Cs; CTIA "non-consumer" definition) and is filtered silently. |
| 12 | `expected_arrivals` no-show = no invoice within 3 days, written for any walk-in suggestion. The no-show sweep uses a bare `CURDATE()`, which AGENTS.md forbids. | `expectedArrivals.ts:210, 366` | Measures the assistant, not the customer (§3). |
| 13 | The `callback-escalation` cron sets `no-answer` without anyone calling. The ">4 h" Telegram prints the full phone number, while the high-urgency `escalate` alert masks it. | `cron/jobs/crudAutomation.ts:212-229`; `voiceAgent.ts:363-376` | Callback outcome data is polluted. The phone-number difference is **OPERATOR**: the owner needs the number to call back (PROTECTED-CORE rule 5 says "unnecessarily"), so it is not changed here. |
| 14 | `conversation_episodes` is written and **read by nothing**. Counter audio is captured during office hours. | `routes/conversationRoutes.ts:79`; no readers | EXT: Ohio protects an oral communication only where there is a justified expectation of privacy. Staff-party counter talk is likely fine; customers talking to each other are not. The `.completion/evidence.json` entry for #2530 records "The operator has confirmed signage is posted" (corrects this row's first draft). |
| 15 | Photo assessment extracts no tire size or DOT code, and there is no customer upload page. The flag `photo_assess_enabled` was switched ON in production 2026-09-22 22:05Z (capability-ledger), and no customer MMS has been observed through it yet. | `vision-analyzer.ts:70-75, 117` | A photo cannot yet replace "read me the numbers on the sidewall". |
| 16 | Four continuity stores and no per-phone context given to voice. `getCustomerJourneyTimeline` exists and is admin-only. | `smsOrchestrator.ts:1697`; `vapi-bdi.ts:71` (reachability depends on Vapi phone-number routing) | Nothing lets the assistant say "is this about the Camry from Tuesday?" |
| 17 | TiDB silently turns `SELECT … FOR UPDATE SKIP LOCKED` into a plain non-locking read — no lock at all (EXT: pingcap/tidb#69782, open, confirmed this session). **nickstire has no such usage** (REPO grep). | — | A guard for any future claim or queue code: compare-and-swap `UPDATE … WHERE state=?` checking affected rows = 1 (the repo's `claim-before-act`). |
| 18 | The memory counterfactual traced two reach paths and missed the receptionist-lesson path (A2). | `nickMemory.ts:254-278` | None today (source filter). Doc accuracy only. |
| 19 | `classifyVoiceDemand` reads a **phone number** as a tire size: "(216) 555-0102" → `tire_size_help`, 0.8. | Pinned by a positive control in `customerCorpus.test.ts`; the census masks before classifying | A caller reciting a callback number would be counted as tire demand. **Whoever wires this classifier must mask first, or fix its size rule.** |
| 20 | 98 bare `CURDATE()` sites in `server/` (UTC session date, not Eastern), despite the AGENTS.md rule. | `grep -rn CURDATE server` | Fixing one is pointless. The fix is a lint gate with an allow-list: **shipped, Part L**. |
| 21 | The stale-callback cron flips an unworked callback to `no-answer` **and stamps `calledAt = NOW()`** with nobody having called. It notes "Auto-SMS: we will call you back" and texts the customer "still in our queue … we'll reach out shortly". The row then leaves the `new` queue. | `server/cron/jobs/crudAutomation.ts:184-229` | A callback nobody worked looks like a callback someone attempted, and it drops out of every "new" count after one more promise to the customer. The queue census's "no-answer 24 of 31" likely includes these; the census now counts them apart through an SQL flag. **Fix (protected core; own PR):** keep `status='new'`, never stamp `calledAt` on the automatic path, and record the auto-text claim in `notes` with a conditional UPDATE. |
| 22 | The prompt promised **untracked callbacks** in three places: the FLOW 1 close ("I'll have the shop check the rack and call you back"), the price-pushback capture, and CALLBACK CAPTURE ("someone can follow up" → a text only). `escalate`, the only tracked callback writer, was forbidden while OPEN. CALLBACK CAPTURE is what the warm-transfer `fallbackPlan` hands an unanswered caller back to. | `vapi.ts` prompt (FLOW 1, Rule 2 pushback, CALLBACK CAPTURE, tools list); runbook line 53 claimed "→ escalate" | The one caller the shop had already failed got the one promise no row recorded. The ledger's "0 callback rows since 09-21" was never evidence the fallback had not fired. **Fixed in this PR**; live after Push Latest Config. |
| 23 | "Push Latest Config" used to PATCH the code defaults whenever its read of the live assistant failed: the placeholder shop landline and the legacy say-message plan with no fallback. | `vapi.ts` `updateAssistant` pre-fetch | One transient Vapi error during a push would silently re-route every transfer and drop the 09-21 fallback. **Fixed in this PR** (fail-closed: refuse and ask to retry). |
| 24 | `escalate` told the model "Nick will call {name} back". | `voiceAgent.ts` escalate response | The model relays tool responses, and nothing assigns the callback to a "Nick" (inbound Critical Rule #2: never promise a specific person). **Fixed**: "the shop will call … back". |
| 25 | `escalate`'s promise-due comment says "next open" but the code uses `nextCloseAt`. | `voiceAgent.ts` escalate → `createVoicePromise` | An after-hours "first thing when we open" was due at the next **close**, which is lenient. **Fixed**: the comment now matches the code, and the spoken promise no longer says "first thing" (#30). |
| 26 | Six voice-agent log calls wrote the caller's **name** to Railway logs. | `voiceAgent.ts` (bookSlot, escalate, tireInquiry ×3, scheduleCallback) | A PII leak `lint:pii` cannot see (it matches shapes). **Fixed**, pinned by `voiceAgentLogPii.test.ts`. |
| 27 | The outbound follow-up assistant opens "this is Nick from Nick's Tire and Auto" and is told not to volunteer that it is AI. The voice-recovery lane (`FEATURE_VOICE_RECOVERY=1` per truth_os) could not connect a single call until the 2026-09-22 dial fix (#2497, on `main`); from now on it **can** place AI-voiced calls to customers with declined estimates. Every voice lane is gated by the unified opt-out index (CURRENT-TRUTH "Outbound consent", 2026-09-16), which covers suppression, not affirmative consent. The SMS consent ledger exists but runs in SHADOW by design (ROS-095). | `vapi.ts` FOLLOW_UP prompt (~437, 463); `cron/jobs/voiceRecovery.ts`; `docs/QUALITY-PROGRAM-2026-09-07.md:334` already lists "any AI-voice outbound call = 'artificial voice' needing prior express consent" as a Phase 2 audit | EXT: FCC 24-17 (2024-02-08). The question was known; what is new is that the lane is armed and now works, so it is no longer theoretical. **OPERATOR/counsel decision before the next voice-recovery run; not changed here.** |
| 28 | FLOW 1 odd sizes said **"let me have the manager confirm stock. Name and best number?"**, then called only `tireInquiry`, which alerts nobody. A caller who would not hold, or called while CLOSED, got a promise with no row. | `vapi.ts` FLOW 1 ODD line (independent review; missed by the first pass) | **Fixed**: odd sizes go to RACK-CHECK — a transfer while open, otherwise CALLBACK CAPTURE through `escalate`. |
| 29 | The towed-vehicle confirm said **"soon as it lands we'll look and call you with the estimate"**: immediate service (Rule 3(b) forbids it) and a callback no row records (`bookSlot` writes no promise). | `vapi.ts` BROKEN-DOWN / TOWED | **Fixed**: "once it's here, free look and a written quote before any wrench moves" (23 words, inside the prompt's 25-word cap). |
| 30 | The CLOSED-hours line promised a callback **"first thing when we open"**, while `escalate` records the promise as due at the END of the next open period (`nextCloseAt`), so a 5:55 PM callback scores as kept. `shopState.ts` justified that bound with "the inbound script states no time", which was false. | `vapi.ts` Rule 6; `voiceAgent.ts` escalate; `shared/shopState.ts` | **Fixed**: "someone will call you back when we're open"; docstring corrected. OPERATOR: a "first thing" promise is fine if the ledger due moves to next-open + N hours. |
| 31 | The outbound follow-up offered **"Want me to have him call you back instead?"** and the confirmation and recovery scripts said "for him": a named-person promise nothing assigns. | `vapi.ts` FOLLOW_UP prompt, confirmation and recovery builders | **Fixed**: "someone from the shop"; "for the shop". The "this is Nick" persona stays with #27 (operator and counsel). |
| 32 | The receptionist's voicemail said **"leave us your name and tire size… we'll call you back"**. | `vapi.ts` `VOICEMAIL_MESSAGE` | **Fixed**: "Call or text us at (216) 862-0005 whenever works." |
| 33 | The recovery lane said **"That quote's still good"** (prompt and voicemail) about a 5–6-week-old quote. No rule makes a quote binding, and the lane dials since the 09-22 fix. | `vapi.ts` recovery prompt and voicemail | **Fixed**: "we'll take another look and go over the quote with you". OPERATOR: if the shop honours quotes for N weeks, record it in `business_facts` and restore the line. |
| 34 | `tireSizeFromVehicle` told callers to **check the door jamb or sidewall and "call back"** (the prompt forbids that homework) and returned a **$60–$120 range** (the prompt forbids ranges; $120 has no source in `BUSINESS`). | `voiceAgent.ts` tireSizeFromVehicle | **Fixed**: "we read it right off the tire when they pull up"; no price field. |
| 35 | Two prompt lines said `tireInquiry` / `bookSlot` give **"the human context"** on a transfer, and `tireInquiry.notes` was "context for the counter". The transfer whisper is fixed text, and the ordinary path discards `notes`. | `vapi.ts` PHONE-CAPTURE-BEFORE-TRANSFER, NO EMPTY TIRE TRANSFERS, `tireInquiry.notes` | **Fixed** to say what happens: the details are on record if the line drops, and not shown to the counter. |
| 36 | The live **voice claim guard** exempted only the old after-hours wording, so every `escalate`-backed CALLBACK CAPTURE promise ("someone will call you back") would have been flagged `unbacked_callback_promise` and fed the daily Telegram alert. | `server/services/voiceClaimGuard.ts`, `vapiCallEval.ts` daily aggregate | **Fixed**: guard v2 reads the call's tool calls and treats a callback as backed when `escalate` ran; the version bump keeps v1 and v2 counts distinguishable (PROTECTED-CORE rule 2). |
| 37 | The capability-ledger checker accepted **"NONE. …" as live evidence**: a non-empty string satisfied `live_verified requires liveRuns`. 11 entries write liveRuns that way (all below the gate today). | `scripts/check-capability-ledger.mjs` | **Fixed**: a field that says it is absent satisfies no gate; canary in `completionAuthority.test.ts`. |
| 38 | `tireInquiry` is still in `WRITE_TOOLS`, so every ordinary tire inquiry sets `convertedToLead = 1` with no lead behind it (the same shape `checkTireStock` was moved out for on 2026-07-20). | `server/services/voice-call-state.ts` | **Not fixed here**: moving it shifts a KPI, so it needs its own PR with a before/after note. |

---

### Shipped in this PR: untracked promises, false claims, and the push that could re-route transfers

Fixed in code: Part C #1, #2, #22–#24, #26, and #28–#37. #1 and #2 are fixed at the text level: the
reply and tool text now tell the truth, the counter still receives nothing, and making "noted"
useful is Part I #5.

- **The ordinary-inquiry reply.** `ordinaryTireInquiryReply()` (`server/lib/tireInquiryReply.ts`)
  says "Got it — 225/65R17, noted." It echoes the size so a mis-heard one can be corrected on the
  spot, and never says it was sent.
- **Every callback any script promises is tracked (#22, #28–#33).** Every line of every script —
  inbound, follow-up, confirmation, recovery, the voicemails, and the strings the tools hand back —
  either routes its callback through `escalate` (which writes `callback_requests` and the Promise
  Ledger) or no longer promises one. No promise names a person.
- **No homework, no range, no false context (#34, #35).**
- **The claim guard agrees with the prompt (#36)**, and **the push fails closed (#23)** when it
  cannot read the live assistant. **No names in logs (#26).** **The ledger checker stops accepting
  "NONE" as evidence (#37).**
- **Proof:**
  - `server/__tests__/vapiToolPromiseTruth.test.ts`, 20 tests. It checks eight scripts and every
    tool description with three matchers (timed promise; callback without `escalate` on the same
    line, explicit or implied; named person), and CALLS the voice-agent procedures to check what
    the model relays. Putting each shipped defect back reddened it: 10 of 10 (the odd-size line,
    the towed line, "have him call", the old voicemail, "first thing", "quote's still good", the
    "sent to the shop" reply in the router, the door-jamb note plus range, the quoteRange note, the
    notes claim). Restored: 20/20.
  - The earlier version of that test only called the reply helper, so restoring the old string in
    the router stayed green (the independent review's finding). Its first "red 4 of 4" was really
    3 of 4 for the named reason: the size-echo test failed only because the helper did not exist
    yet, and the old reply already echoed the size.
  - `server/voiceClaimGuard.test.ts`: v2 backed vs unbacked, with a positive control.
  - `server/completionAuthority.test.ts`: red on the old checker, green on the new one.
  - `server/vapi.updateAssistant.failClosed.test.ts` went red 2 of 3 on the old code; its third test
    pins that a good read carries the live number and the whole live transfer plan.
  - `server/__tests__/voiceAgentLogPii.test.ts` is red on the pre-fix file and green after.
  - Every test file touching the voice surface: 33 files, 422 tests, exit 0; `tsc` exit 0.
- **Ladder — what reaches callers when:**
  - **On deploy:** the tool replies (`voiceAgent.ts`: "noted", "the shop will call … back", the
    size-lookup notes, the rack-check hint), the claim guard, and the confirmation and recovery
    scripts, which are sent with each call (`systemPromptOverride`).
  - **Only on Push Latest Config:** the receptionist's prompt, tool text and voicemail. See A2 for
    what that push also carries.
  - **Only when `scripts/vapi-create-followup-assistant.ts` runs:** the follow-up cadence's
    `FOLLOW_UP_SYSTEM_PROMPT`, which lives on the follow-up assistant in Vapi. The script PATCHes
    the existing assistant; no admin button calls `vapi.updateFollowUpAssistant`.
  - Until each step happens, the live assistant still reads the old text: DEPLOYED ≠ LIVE. The
    legacy notes-based rack-check lead path still works for any notes containing "rack check".

## Part D — Taxonomy, effort, obligations, trust

### §5. Taxonomy — adopt the one already built; do not invent

- **Use `VoiceIntent`** (37 values, `voiceDemandClassifier.ts:31-46`) as the one taxonomy for calls
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
- **Lifecycle test, which the operator asked for before any generalising.** It compares the four
  obligation kinds against the lifecycle OPEN → ASSIGNED → WAITING → FULFILLED / MISSED /
  CANCELLED, with owner, due, source, customer, evidence and completion proof. Read from code:

  | Kind | Persisted today? | Owner | Due | Evidence of completion | Customer sees it |
  |---|---|---|---|---|---|
  | Callback | `callback_requests` (new → called / no-answer / completed); plus a `customer_promises` row **only** via `escalate` (`scheduleCallback` writes one too but is not in `VAPI_TOOLS`) | `calledBy` (free text) | **none** on `callback_requests`; `due_at` = next close on the promise row | `calledAt` (a cron can set `no-answer` with nobody calling) | a "still in our queue" text after 4 h |
  | Rack check | **no row** (`checkTireStock` writes nothing; the legacy notes path writes a lead) | — | — | — | — |
  | Status update | **no row** ("we text when done" rides `drop_off_sms_flow`; the status-message writer is unwired) | — | — | — | — |
  | Transfer recovery | **no row**: a recovery-queue *lane* computed at read time (15-min SLA constant) plus a forwarded-call follow-up text | — | derived | — | the follow-up text |

  **Verdict (REPO):** the four kinds do not share a lifecycle today, because three of them have no
  lifecycle at all. The shape the operator describes already exists as `customer_promises`: open /
  kept / missed / cancelled, `owner`, `due_at`, `source_kind` / `source_id`, `customer_phone`,
  `kept_evidence`. ASSIGNED is `owner IS NOT NULL`; WAITING is `open` before `due_at`. So the
  generalisation is **not a new kernel**. It is making the missing obligations exist as rows in the
  one that is there, then letting the census show whether the four kinds actually behave alike
  (due-window distribution, keep rate, evidence source).
- **Recommendation:**
  1. Every spoken or written commitment calls one helper that writes a `customer_promises` row:
     callback, rack check, "we'll text when done", and "someone will follow up". The helper
     generalises `createVoicePromise`.
  2. `sms_response_jobs.human_pending` rows get a promise row whose `due_at` is the next
     business-hours 30 minutes.
  3. "Kept" only on **outcome evidence** (a delivered text, an inbound reply, or a completed call on
     the promised number), never on an attempt. No code or ledger entry implements this yet; the
     `voice-promise-capture` entry says only an operator produces the "kept" count.
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
  **INFER** (τ-Voice simulated full-duplex speech-to-speech agents; Nick's receptionist is a
  cascaded Deepgram → gpt-4o → ElevenLabs pipeline, so this transfers by analogy only): Nick's
  highest-value voice work is behavioural — what the agent promises and captures — not ASR vendor
  choice.
- **Entity capture.** In the 09-22 sample a size was *spoken* in 4 of 11 tire calls and captured in 3
  (`tire-size-recall.mjs:13-17`); the digit-by-digit miss was fixed the same day. The real
  constraint is callers not giving a size at all.
  **Recommendation:**
  1. Read back and confirm: "225, 65, R17 — right?"
  2. Offer a text link for a sidewall or door-jamb photo.
  3. Stop hoping the regex hears it.
  Vapi structured outputs (EXT, docs) can replace post-call regex extraction for size, quantity,
  vehicle and promised action. Shadow it against `extractDemand` first.
- **Barge-in, silence and latency.** The measured p90 reply gap of 2.29 s is above the ~1.1 s
  cascaded-agent target (EXT: Twilio 2025) and well above the ~200 ms human baseline (EXT: Stivers
  2009). The earlier "Hello? Hello?" latency theory is **refuted** (first assistant audio 0.41 s avg /
  0.64 s max; ≥2 bare "Hello?" in 0.7% of calls — §3). The gap to chase is the reply gap, not
  first audio. Do not change the provider.
- **Warm transfer.** 11 of 11 connected is n = 11. The runbook's ring-out canary has not run, and
  `transfer-update` events are subscribed but unhandled (REPO `vapi.ts:1019`). Handle the event and
  run the canary before calling transfer "proven".
- **Regression evals.** Use Vapi Evals / Test Suites (EXT, docs; already paid for) for tool-call
  assertions over de-identified, human-approved cases mined from `vapi_call_archives`, and the
  existing `tests/eval/run-suite.ts` pattern. `docs/UPSTREAMS.md` already rules on the rest:
  Langfuse is ADOPTED as a Cloud SDK (statenour, 2026-08-25; self-hosting stays rejected), Phoenix
  is WATCH, and Promptfoo is an eval-harness SPIKE scoped to six adversarial classes — not a voice
  regression tool. Do not add a second eval platform for voice.
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
  - ~700–1,000 calls a month (all directions) against 73–145 paid invoices a month (73 is the
    latest 30-day count).
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
2. **Whether price or stock blocks callers first is not yet measured.** The 32% "price
   uncertainty" is a label the classifier attaches by rule to 15 service intents, so "I need an oil
   change" scores as price uncertainty; it restates the intent mix (call-mix-2026-07-26 made the same
   leap). The assistant does speak to both: Rule 4 and FLOW 1 Beat 2 script "we keep most standard
   sizes in stock", and it gives the sixty-dollar used-tire anchor. How often callers voice a price
   concern needs a phrase-level count (the census export plus a reading pass).
3. **Callers are terse.** Half of turns are 3 words or fewer. Designs that need long spoken answers
   (sizes, VINs, addresses) fight the channel. A photo or text link is the fit.
4. **"I'll come by" is usually the assistant's phrase, not the customer's commitment.** 66 of 89
   no-shows never named a day (CORPUS·prior).
5. **Customers text rarely.** 43 inbound texts in 30 d. The 74% "not answered within 2 h" covers
   the 180 days to 07-25, mostly before the SMS orchestrator (ROS-058), so it says nothing about
   reply speed today. EXT says 56% of tire customers *prefer* texted updates.
   **Contradiction to test:** low inbound SMS may reflect that we never invite it and answer it
   slowly, not low preference.
6. **Before warm transfer, about a quarter of forwarded callers called back within 15 minutes.**
   That is the clearest measured friction in the data. Warm transfer (09-21) may have fixed it
   (n = 11).

### §12. What the shop is accidentally training customers to do (each with its evidence grade)

| Trained behaviour | Evidence | Grade |
|---|---|---|
| **Redial** after a transfer | 22–28% forward → redial within 15 min (before 09-21) | CORPUS·prior (measured) |
| **Ask for a person first** | The AI gives only three price anchors and hands every stock-confirmation request to a person, so a caller who wants a firm number or a confirmed tire has a reason to bypass it | INFER (mechanism from the prompt; frequency and causation unmeasured) |
| **Repeat the tire size** | Part C #1: "sent to the shop" persisted nothing | REPO mechanism. Repeating it at the **counter** is visible to no read today; the census's `reaskedKnownSize` only sees the assistant re-asking in a later call |
| **Call for status** | No status tool, the proactive status writer is unwired, and status calls are transferred | REPO mechanism; `active_job_status` share unmeasured |
| **Not bother texting** | 45 `human_pending` rows (~34 customers), 25–27 over 30 d; the 74% figure is pre-orchestrator (§3) | CORPUS·prior + INFER |

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
4. ~~Delete the "promised 15 min callback" text~~ (done in this PR). Still open: the unregistered
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
4. A voice provider migration. INFER from τ-Voice (a simulation of full-duplex agents; Nick's is
   cascaded): the gap is behavioural.
5. Another dashboard. The 1,118-row queue lesson.
6. Proactive marketing blasts over the Android gateway. It is a carrier-terms risk and has no
   fallback.
7. LLM summaries of counter audio before a customer notice policy exists (the operator confirmed
   signage is posted, Part C #14) and before coverage stays above 65% for a week.
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
| Stop the false "sent to the shop" | **MODIFY** | `voiceAgent.ts:628-644`, `vapi_call_logs.metadata.demand` | Part C #1 · repeat burden · Zendesk 2026: 74% frustrated repeating (vendor) | A unit test: an ordinary inquiry writes demand to metadata; the message text is unchanged or truthful | A production call row with `metadata.demand.tireSize` from `tireInquiry` | a counter-side "size known on arrival" event on the card (the census cannot see the counter; `reaskedKnownSize` measures only the assistant re-asking) · revert commit · falsifier: < 5% of tire walk-ins called first |
| Remove the untracked 15-min promise | **DELETE — done in this PR** | `vapi.ts` tool text | Part C #2 · prompt contradiction | `vapiToolPromiseTruth.test.ts` (timed-promise matcher over every script and tool text) | The Vapi assistant config after push carries the new description | Assistant promise count (census) · revert · — |
| Obligation writer | **CONSOLIDATE** into `customer_promises` | `promiseLedger.ts:310`, `escalate`, `sms_response_jobs` | §7 · 0 rows · McCollough 2000 | A promise per commitment kind; kept only with evidence | A non-zero `customer_promises` row from voice, kept by evidence | kept / (kept + missed) · flag `promise_writer_enabled` · falsifier: < 3% of episodes carry a promise |
| Wire `classifyVoiceDemand` | **MODIFY** (wire) | `voiceDemandClassifier.ts`, `vapiCallEval.ts` | Part C #4/#5 | Shadow field written; parity test against the fixture | 14 days of shadow rows in production; disagreement table from the census | `unclear` share, tire share · shadow-only · falsifier: disagreement < 5% |
| Gap episodes | **MODIFY** | `callTaxonomy.ts:389` | Part C #6 | `customerCorpus.test.ts` case moved to the kernel | Queue episode count vs census call episodes | rows per customer · revert · falsifier: kernel and gap counts within 2% |
| Close path for texts | **MODIFY** (wire UI) | `markNoReplyNeeded`, `SmsOrchestratorSection.tsx` | Part C #8 · 45 pending | RTL test: the button calls the procedure; two-tap confirm (iOS PWA rule) | `human_pending` count reaches ≤ 5, none > 7 d | median age · — · — |
| Rack-check result text | **NEW** (thin) | `checkTireStock`, promises, `orchestrateSms` | §8 · stock-confirmation hand-offs · J.D. Power photo effect | Admin "checked" action writes evidence and a draft text | 10 production rack checks closed with a sent result | arrival ≤ 3 d (switchback) · flag · falsifier: no arrival lift after 60 blocks |
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
4. ~~Delete the "promised 15 min callback" tool text~~ and ~~route every callback promise through
   `escalate`~~ **Done in this PR** (Part C "Shipped"). The Vapi config push is still an OPERATOR
   click. Still open: the dead `scheduleCallback` / `quoteRange` dispatch and auditor branches.
4b. The stale-callback cron (Part C #21): stop stamping `calledAt` / `no-answer` on the automatic
   path. Protected core, so its own PR with targeted tests.
5. `tireInquiry` → `metadata.demand` persistence plus a counter card (depends on nothing). Measure
   it with a "size known on arrival" event on the card: the census cannot see the counter.
6. Add the safety rule and spoken-size normalisation to `voiceDemandClassifier`, then shadow-wire it
   into `vapi-eval` (depends on 1 for the baseline).
7. Gap-based episodes in `recoveryQueue` (depends on 6 for family attributes).
8. One obligation-writer helper plus outcome-evidence keeping (depends on 3 and 4).
9. Rack-check result flow (depends on 8).
10. Status on request (depends on 8 for the promise when a status is owed later).
11. `transfer-update` handler plus the warm-transfer canary (independent; the canary is an OPERATOR
    test call).
12. Promote the census rules to invariants (A3).
13. Photo-assess structured size extraction (no dependency left: `photo_assess_enabled` has been on
    since 2026-09-22 22:05Z).
14. Re-run the census monthly. Compare the primitives, and kill any item whose falsifier fired.

---

## Part L — The `CURDATE()` gate, and the sites to fix, ranked by customer effect

`pnpm lint:curdate` (`scripts/lint-curdate.mjs`, with a baseline in `config/curdate-baseline.json`)
fails on any **new** bare `CURDATE()` in `server/**/*.ts`. The session date is UTC, so "today" flips
at 8 PM Eastern (7 PM in winter).

- **Baseline:** 96 occurrences in 28 files. Comments are not counted, and neither are tests. Each
  file carries an effect class and a reason.
- **Ratchet:** fixing a site fails the gate until the baseline is lowered, so the freed slack cannot
  absorb a new site later.
- **Proof:** `scripts/lintCurdate.test.ts` has 6 tests. A planted site fails, the real tree passes,
  and blinding the matcher reddens 4 of them. `adoption-gates.yml` carries the same planted/clean
  canary pair as the knip gate.
- **Wiring:** in `pnpm run verify` and in the `node` CI job, for parity.
- **Fix to use:**
  - `getBusinessDateKey()` (`server/lib/timezoneAssert.ts`, the NT-009 fix), passed as a parameter;
  - or `DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))` in SQL (`kpiSnapshot.ts`).

**Every effect below happens only while the code runs between 20:00 and midnight Eastern.** No site
controls an SMS sending window: `sms.ts` computes those in Eastern time in JS (verified).

| Rank | File (sites) | Class | What goes wrong after 8 PM ET |
|---|---|---|---|
| 1 | `services/expectedArrivals.ts` (1) | customer-state | The no-show sweep marks an arrival `no_show` hours early, and `no_show` feeds the recovery lane. |
| 2 | `cron/jobs/retentionSequences.ts` (1) | customer-send | Every retention tier boundary shifts a day, which changes which customers get which text. |
| 3 | `routers/campaigns.ts` (2) | customer-send | A campaign audience built then moves a customer across the 90-day line a day early. |
| 4 | `services/weatherIntelligence.ts` (1) | customer-send | The weather push's lapsed-customer set (≥ 60 days) shifts a day. |
| 5 | `services/opportunityQueue.ts` (1) | customer-state | A booking becomes a missed-booking opportunity a day early, which can put a customer into an outreach queue. |
| 6 | `routers/chat.ts` (1) | customer-view | The web chat's "bookings today" context reads 0. The shop is closed then, so the effect is small. |
| 7 | `services/engines/revenue.ts` (4) | staff-today | `bookings.preferredDate` (an Eastern date string) is compared with the UTC date, so today's bookings drop out of "upcoming" and count as no-shows. This is the NT-009 shape. |
| 8 | `cron/jobs/statenourSync.ts` (13), `_core/statenour-bridge-routes.ts` (8) | staff-today | The owner's today/yesterday revenue: "today" reads empty and "yesterday" reads today. |
| 9 | `services/dataPipelines.ts` (11), `services/intelligenceEngines.ts` (4), `routers/advanced/invoices.ts` (11), `routers/customers.ts` (2) | staff-today | Week-to-date and month-to-date figures roll to the next period on the boundary day. |
| 10 | `cron/jobs/intelligenceAutopilot.ts` (5), `services/safetyMonitor.ts` (7), `services/shopDriverMirror.ts` (1), `routers/intelligence.ts` (1), `routers/conversion.ts` (1) | staff-today | "Today" counts read zero. |
| 11 | `cron/jobs/unpaidInvoiceRecovery.ts`, `cron/jobs/vapiCallEval.ts`, `cron/jobs/vapiLatencySync.ts`, `services/competitorMonitor.ts`, `services/costDetailCoverage.ts` (1 each) | alert-dedupe | A once-per-day alert key rolls at 8 PM, so an alert can repeat or be held within one Eastern day. |
| 12 | `routers/controlCenter.ts` (2), `routers/trafficFunnel.ts` (4), `routes/nour-os-query.ts` (7), `services/declinedWorkSignals.ts` (1), `services/shopStatus.ts` (2) | rolling-window | An N-day window drifts by a few hours. Lowest priority. |

Fix ranks 1–7 one file per PR, each with a test that fixes the clock at 21:00 Eastern and asserts
the Eastern date is used. Each fix lowers the baseline in the same PR.

## Part K — Operator steering 2026-09-23, folded in

**What changed in this PR because of it:**

- **`customer_had_to_recontact_shop`.** The census now reports, per need and overall, episodes where
  a customer-initiated contact came ≥10 minutes after the previous one ended. Reconnects under 10
  minutes are counted apart, because a dropped line is not "the first contact did not finish the
  job".
- **`episode_link_confidence`.** Each episode is `single` / `consistent` / `ambiguous`. Ambiguous
  means two contacts named needs from different families; tire intents count as one family.
  Ambiguous episodes are reported, never forced apart or together.
- **Incident grouping (SRE).** Transfer failures cluster into one system incident when three or
  more customers fail within 60 minutes of each other. A failure is the provider's `not_connected`
  verdict, or, before verdicts existed, a forwarded call redialled within 15 minutes (labelled as a
  proxy). The output reads as 1 incident plus N customer-recovery obligations, not N lost leads.
- **The export the operator specified.**
  - `--export <file>` writes one JSONL row per episode, with no raw phone and no name:
    - a salted `customerKey`;
    - masked turns (capped at 400 characters);
    - masked text bodies;
    - per-contact need, transfer, eval outcome and ended reason;
    - every derived primitive.
  - `customer_name_present` is kept as a boolean only.
  - It refuses to write inside a git checkout and writes mode 600.
  - A **stable** salt for month-over-month joins comes from `CORPUS_ANALYSIS_SALT` in the shell,
    never the repo; without it the salt is per-run.
  - Media counts are **not** exportable: `sms_messages` has no media column.
- **Join.** `revenue_opportunities` rows inside each episode, and whether one was `won`.

**Where the steering and this document disagreed, and what stands:**

| Point | Steering said | Evidence | Stands as |
|---|---|---|---|
| Arize Phoenix | BORROW / maybe adopt | The licence is **ELv2** (verified from its LICENSE by the OSS scan). ELv2 **permits internal self-hosted use**; it forbids offering Phoenix as a hosted service. So it is legal for Nick's internally, and my Part J line "never embed ELv2" was too broad. The blocker is operational: a Python server that duplicates the eval cron plus promptfoo. | **BORROW the dataset-from-production and versioned-experiment mechanisms; do not deploy.** Part J corrected. |
| Memory traps | Promote all five into guards | The memories are machine-local and were not visible here. Only two are cheap, checkable invariants: ledger-edit-without-render (already completion sub-gate 4, so the memory can shrink to "guard: completion-authority sub-gate 4"), and the co-author trailer on squash merges (a merge-helper check). "TaskStop leaves children" and "Railway rate limit" are harness or tool behaviour a repo test cannot exercise. The best guard for them is a wrapper script used everywhere (for example a `railway-read` wrapper with backoff), otherwise they stay memories. "git add bad pathspec": a pre-commit completeness check (staged set against intended set) is heavier than the trap it prevents. | Promote the two cheap ones; wrap Railway reads; keep the TaskStop memory in the short form "failure + guard". |
| Obligation kernel | Test whether the four kinds share a lifecycle | Part D §7 now carries that test from code: three of the four have no persisted lifecycle, and `customer_promises` already has the target shape. | No new kernel. Make the missing rows exist in `customer_promises`, then let the census decide. |
| Vapi assistant-based warm transfer | Canary it | Confirmed this session against Vapi's docs: `warm-transfer-experimental` gives the transfer assistant `transferSuccessful` / `transferCancel` (voicemail, busy, no answer, IVR, decline), and no telephony-provider restriction is stated. It is already the live mode per the runbook. | Handle `transfer-update`, run the ring-out canary, then call it LIVE-OBSERVED. |
| RCS | Watch / small pilot | Business RCS needs a registered brand and agent through an aggregator; it cannot ride the Android gateway. | WATCH. SMS stays universal. |

**The operator's 20 corpus questions, mapped to what answers them:**

| # | Question | Answered by |
|---|---|---|
| 1–2 | Top jobs-to-be-done; tire vs repair vs status/info share | census §3 (need per episode) |
| 3 | What customers volunteer first | export → first customer turn per episode (masked) → TnT-LLM-style labelling pass |
| 4 | What Nick asks unnecessarily | census §5 asks, plus `reaskedKnownSize` / `Vehicle` |
| 5 | Corrections of size, vehicle or name | census `not_understood` friction (proxy); the exact fields need the export plus a reading pass |
| 6 | Causes of same-day redials | census redial and recontact by need; the export for why |
| 7 | Transfer initiated → verified connection | census transfer tried / connected / verified-failed, plus incidents |
| 8 | Which callback promises close | census promised → delivered follow-up; `callback_requests` done |
| 9 | "Coming today" → arrival | census arrival row → arrived. Remember that the row is mostly the assistant's suggestion (§3). |
| 10 | Invoice-linked vs non-linked episode shape | export, split on `linkedInvoice` |
| 11–12 | Which texts get replies; what prompts STOP | census texts section plus the export (the outbound body before a STOP) |
| 13–14 | AI replies that trigger human intervention; where humans do better | `sms_response_jobs` outcomes plus `nickgpt_drafts` edits (not yet in the census — add when the census first runs) |
| 15 | Highest-effort episodes | sort the export by the raw primitives (no composite) |
| 16 | Labour without customer value | the `active_job_status` share plus the transfer-connected share, per need |
| 17 | Status calls a status text could remove | the `active_job_status` episode count (upper bound) |
| 18 | Where photo intake removes knowledge burden | **Not answerable from the classifier**: `tire_size_help` / `unknown_tire_size` fire when a caller *states* a size (and on phone numbers), not when they cannot give one. Needs a "don't know my size" phrase count in the export reading pass |
| 19 | What a high-converting *legitimate* tire episode looks like | export: linked tire episodes against unlinked ones |
| 20 | What correlates with repeat customers | census `existingCustomer` plus a 90-day forward join (next monthly run) |

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
7. OSS: borrow mechanisms from permissive licences (MIT/Apache/BSD). Never embed or redistribute
   AGPL, SSPL, BSL or unlicensed code (Unleash server, Emmett, Inngest server, Restate, Twenty).
   ELv2 (Phoenix) permits internal self-hosting but not embedding or hosting as a service;
   prefer its mechanisms.
   TiDB silently turns SKIP LOCKED into a plain non-locking read: claims are compare-and-swap
   UPDATEs checking affected rows = 1.
8. Privacy: mask before match, match before print; phones as hashes in any artifact; no PII in logs
   or Telegram.
9. Report with receipts: files, tests (N passed, exit 0), PR link, what is DONE / BLOCKED-ON-X /
   NOT-STARTED.
```
