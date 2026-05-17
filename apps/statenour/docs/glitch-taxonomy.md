# NOUR OS · Glitch Taxonomy

**Working operational guide for system hardening.**

> Started 2026-05-06 (v10.0.333) after a /chat post-creation session
> surfaced 4 glitches across 4 different failure categories. Goal: make
> "everything operates without error" a verifiable claim by enumerating
> the failure modes, where they live, how to detect them, and how to
> prevent them — across all 8 root-cause categories.

This is the **canonical reference** for prevention work. New glitches
get filed against the matching category. New categories get added when
we hit something that doesn't fit.

---

## Category 1 · Contract drift

**External API calls assume an action/shape that the API no longer provides.**

### Failure modes

| Mode | Real example we've hit | Other places this could hit |
|------|------------------------|----------------------------|
| Action renamed | `revenue_week` (nickstire) | Buffer endpoint renames, Meta Graph version bumps |
| Field renamed | `totalDollars` vs `amount` | Venice→OpenAI shape changes (`b64_json` vs `data[0].url`) |
| Required filter changed | `since` → `from`/`to` | Date format drift (ISO vs YYYY-MM-DD) |
| Auth changed | (will hit ~Jun 27 with Meta token) | OpenAI org keys, Venice scope changes |
| Rate limit tightened | (haven't hit recently) | Meta 200/hr → 100/hr drop, Venice burst limits |
| Endpoint deprecated (410) | (haven't hit) | OpenAI DALL-E 2 deprecated, Anthropic legacy models |
| Response shape wrap change | `data.X` vs `X` | Bridge envelope drift (just hit with `result.data.totalDollars`) |
| Action exists but returns empty | (`leads_open` returns empty array because feature unbuilt) | New tools shipped on bridge but stub endpoints |
| Optional field becomes required | (haven't hit) | Newly-mandatory `mediaType` in chat parts |
| HTTP method changed | (haven't hit) | POST→PUT for idempotent ops |

### Where it shows up (surfaces)

```
lib/nickstire/query.ts                  // bridge calls
lib/ai/provider.ts                      // model selection
lib/buffer-api.ts                       // social schedule
lib/meta-graph.ts                       // IG/FB publish
lib/integrations/auto-labor-guide.ts    // ALG / ShopDriver
lib/ai/venice-image.ts                  // legacy image gen
lib/ai/openai-image.ts                  // gpt-image-1
lib/integrations/resend.ts              // email
lib/integrations/telegram.ts            // chat ops
lib/integrations/apollo.ts              // lead enrich
lib/integrations/fireflies.ts           // meeting transcripts
lib/integrations/descript.ts            // audio
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| 4xx/5xx with patterned bodies | error log regex `/Unknown query|Invalid action/` | > 0 / hour = drift |
| Sudden null fields in dashboards | nightly snapshot diff vs prior 7-day median | > 30% null delta |
| `provider-health` probe red | `/api/provider-health` ping | red persists > 2 cycles |
| Type-narrowing failures | `(data as { x?: number })?.x === undefined` ratios | > 5% |
| Bridge "Unknown query" warn-once log | grep server logs for the warn-once line | any match = file ticket |

### Prevention mechanisms (ranked by leverage)

1. **Pre-flight contract test** · highest leverage · low effort
   - On deploy, hit each external action with stub args
   - Verify response shape matches zod schema
   - Fail deploy if any contract diverges
   - Lives in: new `scripts/contract-pre-flight.ts` + 15-step pre-push gate as step 16

2. **Zod-validated response wrappers** · high leverage · medium effort
   - Wrap every external fetch with `parse(schema, response)`
   - Type errors at compile time when schema diverges
   - Existing `lib/nickstire/query.ts` should adopt this pattern

3. **`/system/contracts` heartbeat dashboard** · medium leverage · low effort
   - Each external action: last success timestamp, rolling success rate
   - Red / amber / green tile per action
   - Operator surface for "is anything drifting right now?"

4. **Contract.md → CI lint** · high leverage · low effort
   - Grep code for `queryNick("X")` calls
   - Cross-check against `docs/NICKSTIRE-QUERY-CONTRACT.md` action list
   - PR-block when caller adds an action not in the contract

5. **Warn-once log dedup** · already shipped (v10.0.331)
   - "Unknown query" 400s warn once per process, not every poll

### Existing infrastructure to extend

- `docs/NICKSTIRE-QUERY-CONTRACT.md` (documented, not enforced)
- `/system/diagnostics` probe runners
- `/system/cron-diagnostics` (similar pattern, extend)
- `lib/nickstire/query.ts` retry + backoff scaffold

### New infrastructure to build

- `scripts/contract-pre-flight.ts` (probe runner)
- `lib/contracts/schemas.ts` (zod schemas for every external action)
- `app/(mastery)/system/contracts/page.tsx` (heartbeat dashboard)
- `tests/contracts/*.test.ts` (one test per action)

---

## Category 2 · Model output leakage

**Model emits internal/template text that shouldn't reach the user.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| XML pseudo-tags | `<request><instruction>...</instruction></request>` (turn 10) | Tool-call JSON wrappers, schema templates |
| Think tokens | `<think>...</think>` (Venice GLM emits these) | `[thinking]`, `<reasoning>` |
| System prompt echoes | "As an AI assistant, I'm here to help…" | "I'm a helpful AI", "As a language model" |
| JSON schema templates | `{"action":"...", "args":{...}}` as text | Function-call signatures leaked |
| Generic LLM fillers | "Certainly!", "I'd be happy to" (already stripped) | "Sure thing!", "Of course!" |
| Hallucinated tool markdown | `[image]` placeholder, fake `/api/images/<bogus_id>` | Fake citation links, fake tool results |
| Stop-sequence misses | Model continues past `</answer>` | Past `### END`, past `---` separator |
| Synth template wrappers | The image-prompt synth output before parsing | Plan-mode template echoes |
| Rephrased system prompt | Model paraphrases its instructions back | "I should respond by…" leak |
| Unicode escape leakage | `<` instead of `<` rendered literally | Encoding round-trip failures |
| Code-fence drift | ` ```typescript` opened but never closed | Multi-fence collisions |

### Where it shows up

```
lib/ai/output-sanitizer.ts              // current sanitizer (filler + XML)
lib/services/chat/persist-assistant-turn.ts  // pre-persist gate
lib/ai/chat/fabrication-rewriter.ts     // L2 defense for action claims
lib/ai/chat/sanitize-history.ts         // history sanitization
lib/ai/chat/truth-grounding.ts          // claim verification
```

Every assistant render path:
- `/chat` page (live stream + persisted history)
- `/api/ai/assist` (one-shot)
- `/api/ai/voice-to-content` (TTS-fed output)
- Daily brief generator
- Review wizard generator
- Plan-mode generator

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Regex match on output | `/<request>|<instruction>|<think>/.test(text)` | any match = leak |
| Length anomalies | output length >> historical median | 2× median |
| Structured-token presence | JSON-schema-like text in output | any |
| Critic score drop | output-critic cliche flag | score < 60 |
| Sanitizer-trimmed bytes | `sanitizeResponse().trimmed > 50` | per-message log |
| Operator regen rate | "do it again" frequency | > 10% of turns |

### Prevention mechanisms

1. **Sanitizer pipeline expansion** · highest leverage · low effort
   - Current: filler + XML-template
   - Add: think-tag stripper (already exists as `stripThink` in persist-assistant-turn)
   - Add: JSON schema detection
   - Add: hallucinated `[image]` placeholder removal
   - Lives in: `lib/ai/output-sanitizer.ts` (extend)

2. **Per-pattern test corpus** · high leverage · low effort
   - Every leak found becomes a regression test
   - `tests/ai/output-sanitizer.test.ts` should have 50+ inputs
   - Failing test = sanitizer regression caught at CI

3. **Output critic flagging** · medium leverage · medium effort
   - Already partial (`critic` field on every assistant message)
   - Extend: explicit "leakage detected" reason
   - Banner in /chat: "Nick output template chrome — investigate"

4. **Pre-persist validator** · high leverage · low effort
   - Strip + warn before write to DB
   - Already partial (sanitizer runs in persist-assistant-turn)
   - Extend: also validate before stream-send

5. **System-prompt lint** · medium leverage · low effort
   - ESLint rule: forbid raw `<request>` / `<instruction>` in system prompts unless explicitly tagged
   - Prevents new leakage patterns from ever shipping

### Existing infrastructure to extend

- `lib/ai/output-sanitizer.ts` (sanitizeResponse + hasFiller)
- `lib/services/chat/persist-assistant-turn.ts` (stripThink + cleanedText)
- `lib/ai/chat/fabrication-rewriter.ts` (L2 defense)
- `tests/ai/prompt-sanitize.test.ts` (10 tests, expand)

### New infrastructure to build

- `tests/ai/output-sanitizer.test.ts` (per-pattern fixtures, currently missing)
- `lib/ai/output-leakage-classifier.ts` (LLM-fallback for ambiguous patterns)
- `app/(mastery)/system/output-quality/page.tsx` (sanitizer-trimmed-bytes dashboard)

---

## Category 3 · NLU pattern misses

**Regex/classifier doesn't match real user phrasing.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Word-count caps | regen detector capped at 10 words → 18-word complaint missed | quick-add parser, action-intent detector |
| Missing synonyms | "redo" yes, "reroll" no | "improve" yes, "polish" no |
| Typo tolerance | "tirw" (Nour wrote it) | "wedensday", "tommorow" |
| Multi-language | (could hit · you speak Arabic + Spanish) | Mixed-language ("change esto") |
| Context-dependent intent | "publish it" = post or schedule? | "do it" = which "it" |
| Numeric edge cases | "0 leads", "-5 cars" | Negative deltas, zero-state |
| Slang/colloquial | "tha pic", "yo gimme" | "lemme see", "fix em up" |
| Negation handling | "don't post that" | "not the image" |
| Question vs command | "should I post?" vs "post it" | Tone-driven intent |
| Compound asks | "make a post AND schedule it" | Multi-intent in single message |
| Reference resolution | "the second one" | Anaphora across turns |
| Acronym ambiguity | "IG" = Instagram or "I guess" | Domain-specific shortcuts |

### Where it shows up

```
lib/ai/image-prompt-synth.ts            // looksReferential, looksLikeRegenAsk (new)
lib/loops/quick-add-parser.ts           // task quick-add
lib/ai/chat/action-intent-detector.ts   // detect "publish/send/post"
lib/ai/chat/action-claim-detector.ts    // claim verification
lib/brain/categories.ts                 // brain category routing
lib/ai/voice-input.ts                   // voice→intent
lib/chat/looks-like-brain-dump.ts       // brain-dump detector (already has tests)
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Low classification confidence | LLM-fallback fires for X% of detections | > 20% |
| User re-asks same thing different way | clientMessageId N + N+1 high-similarity | similarity > 0.8 |
| Regen frequency | "do it again" / "no try X" turns | > 10% |
| "go back re-read" pattern | turn 17-style frustration | any occurrence |
| Detector miss rate (live capture) | post-hoc: would-have-fired vs actual-fired | > 15% |
| Operator 1-tap thumbs-down | per-turn feedback | > 5% |

### Prevention mechanisms

1. **Per-detector phrase corpus** · highest leverage · medium effort
   - Each detector ships with a corpus file of 50+ real user examples
   - Examples come from production logs (anonymized)
   - Test suite asserts detector fires on every corpus phrase
   - Lives in: `tests/fixtures/<detector>-corpus.txt`

2. **Live capture loop** · highest leverage · medium effort
   - Every "did this match?" tap by you feeds the corpus
   - Failing matches auto-create a brain memory `category=detector_miss`
   - Weekly cron pulls misses + proposes corpus additions

3. **LLM-classifier fallback** · medium leverage · low effort
   - When regex confidence < threshold, call fast LLM to classify
   - More expensive but catches edge cases
   - Already pattern in `image-prompt-synth.ts` (synthesize when referential)

4. **Multi-language fixtures** · medium leverage · low effort
   - Add Arabic + Spanish examples to every corpus
   - You speak both, queries WILL eventually be mixed-language

5. **Compound-intent parser** · low leverage · high effort
   - Detect "AND" clauses, route each independently
   - Defer until we see compound asks fail

### Existing infrastructure to extend

- `tests/chat/looks-like-brain-dump.test.ts` (13 tests — pattern to copy)
- `tests/ai/chat/resolve-media-type.test.ts` (10 tests — pattern to copy)
- Brain memory `category=detector_feedback` (could exist, query first)

### New infrastructure to build

- `lib/feedback/detector-miss-capture.ts` (auto-store on detected miss)
- `tests/fixtures/<detector>-corpus.txt` (per detector, currently none)
- Cron job: `weekly-detector-corpus-review` (compile misses → propose adds)
- `/system/nlu-coverage/page.tsx` (per-detector test coverage + miss rate)

---

## Category 4 · Concurrency races

**Parallel writes/state updates produce duplicates or wrong order.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Double assistant reply | turn 4+5 (same parentMessageId, 76s apart) | Multi-tab same convo, abort+retry |
| Optimistic update + server race | task complete-then-server-says-no | Mission status flip, brain memory race |
| Cron overlap | (have lock pattern but not enforced everywhere) | Two instances pulling same job |
| Stream finish + abort race | Client aborts mid-stream | `onFinish` still fires, persists partial |
| Brain memory write-during-read | Stale read | Multi-write same key |
| Task complete-then-undo | Optimistic UI flip | Project re-open after close |
| Multi-tab same conversation | Both tabs stream | Both tabs persist different turns |
| Image-gen + abort race | User clicks stop mid-render | Image still arrives, persisted as new turn |
| Edit-during-stream | User edits prior turn while next streaming | Branch divergence |
| Retry-after-success race | Retry fires before first success persists | Two completions for one ask |

### Where it shows up

```
lib/services/chat/persist-assistant-turn.ts  // onFinish handler
app/api/ai/chat/route.ts                     // streamText config
lib/cron/runner.ts                           // cron lock pattern
/api/tasks/[id]/check                        // task complete optimistic
/api/missions/*/status                       // mission state changes
lib/brain/bus.ts                             // event ordering
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Duplicate-row detection on persist | `(conversationId, parentMessageId)` count > 1 | any |
| Race telemetry | Two writes within 100ms same key | any |
| Idempotency-key violations | clientMessageId reuse | any |
| Multi-tab presence | session count > 1 per user | passive flag |
| Cron overlap | Two `cron_run_*` events same name within window | any |
| Stream-abort orphans | streamingState=streaming with no recent token | > 5min |

### Prevention mechanisms

1. **Idempotency keys + DB unique constraint** · highest leverage · low effort
   - `clientMessageId` already exists on user messages
   - Add unique index `(conversationId, parentMessageId, role)` on chat_messages
   - Server: `INSERT ... ON CONFLICT DO NOTHING`
   - Catches the double-reply glitch directly

2. **Single-flight pattern** · high leverage · medium effort
   - Track in-progress operations by `(conversationId, parentMessageId)`
   - Reject new request if same key in-flight
   - Lives in: new `lib/concurrency/single-flight.ts`

3. **Stream-finish dedup** · high leverage · low effort
   - `onFinish` checks if a message with same idempotency key already persisted
   - If yes, skip persist (caught the race)
   - Modify `persist-assistant-turn.ts`

4. **Cron lock enforcement** · high leverage · low effort
   - Pattern exists (`BrainMemory category=cron_lock`)
   - Audit: which crons have lock, which don't
   - Apply uniformly via cron runner wrapper

5. **State machine validation** · medium leverage · medium effort
   - Tasks/missions/conversations have explicit state machines
   - Reject illegal transitions (DONE → IN_PROGRESS)
   - Lives in: per-entity state-validator helpers

### Existing infrastructure to extend

- `clientMessageId` field on chat_messages (just needs unique constraint)
- `BrainMemory category=cron_lock` pattern (extend coverage)
- `streamingState` field on chat_messages (use for dedup)

### New infrastructure to build

- DB migration: unique index `(conversationId, parentMessageId)` on chat_messages
- `lib/concurrency/single-flight.ts` (in-flight tracker)
- Telemetry: race-detection events to brain_bus
- `tests/concurrency/*.test.ts` (multi-tab simulation)

---

## Category 5 · Workflow stalls

**User can't progress; system silently fails or shows null.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Silent null in HUD chip | week-revenue null after bridge 400 (just fixed) | Any HUD/dashboard chip with try/catch→null |
| Post-publish silent fail | (haven't audited) | Buffer schedule that 200s but didn't post |
| Image-gen rejected, no retry | (have retry banner now) | Voice transcribe failed, mic still green |
| Stuck mission/task state | Mission IN_PROGRESS forever | Task DOING never resolves |
| Brain memory not surfacing | Despite being stored | Pinned memory below injection threshold |
| Voice mic green, transcript empty | (could happen) | TTS output silent |
| "Action: Publish" text without button | turn 4 (Nick said "Action: Publish" but no UI button) | Any "ready to ship" CTA without ship affordance |
| Workflow doesn't progress (turn 18) | Nick re-emits post but doesn't fire publish | Loop without exit |
| Empty list with no explanation | "No data" instead of "API returned empty" | Filtered-to-zero results |
| Stale data shown as live | Cache returned stale, no freshness indicator | Cron-driven dashboards |

### Where it shows up

Every UI surface that:
- Calls an API and expects data (HUD, dashboards, /chat header)
- Has a state machine (tasks, missions, brain memories, conversations)
- Has multi-step flows (post creation, publish, review wizard)

```
components/hud/*                        // HUD chips
app/(mastery)/system/health/page.tsx    // health surface
components/chat/header-hud.tsx          // chat HUD
components/actions/loop-stream.tsx      // task list
components/social/publish-flow.tsx      // post → publish
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Long dwell time on workflow step | client-side timing | > 60s on a step that should take < 10s |
| Repeated retries by user | Same user message twice in 30s | > 1 |
| Stuck non-terminal status | task/mission in IN_PROGRESS > X days | > 7d |
| Empty-state fallthrough | render empty without "why empty" | manual audit |
| Same data returned for X polls | HUD chip value unchanged across N cycles | unusual for live data |
| Repeated "wait re-read the ask" pattern | NLU detector | per chat session |

### Prevention mechanisms

1. **"Last good value + staleness chip"** · highest leverage · low effort
   - Every HUD chip remembers last non-null value
   - Show with timestamp ("revenue $X · updated 12m ago")
   - When fetch fails, fall back to last good + amber chip
   - Replaces silent-null state

2. **Explicit "this is null because X" UI** · high leverage · medium effort
   - Empty state always has reason: "Bridge unreachable" / "No matching data" / "Permission denied"
   - Never show plain empty without context
   - Lives in: per-component `<EmptyState reason={...}>` primitive

3. **State machine validation** · high leverage · medium effort
   - Per-entity state machines explicit
   - "Stuck > X days" cron sweep flags violations
   - Auto-resolve or escalate

4. **Workflow contract test** · high leverage · medium effort
   - Define each multi-step workflow as a contract:
     - Post creation → must end in publish OR explicit-cancel
     - Mission cycle → must reach DONE within Xd
     - Review wizard → must save outcome
   - Synthetic test exercises the full flow
   - Auto-fails if workflow can't terminate

5. **"Things degraded" banner** · medium leverage · low effort
   - Single banner at /chat header when ANY external dep is degraded
   - "Bridge down · revenue chip stale" / "Venice slow · using fallback"
   - Replaces silent-fail with operator-visible signal

### Existing infrastructure to extend

- `FreshnessChip` component (use for last-good staleness display)
- `/system/health` (extend to include workflow health)
- Cron scheduling pattern (add stuck-state sweeps)

### New infrastructure to build

- `<EmptyState reason={}>` primitive (replace plain `null` returns)
- `lib/workflow/state-machine.ts` (per-entity state validators)
- `tests/workflows/*.test.ts` (synthetic full-flow tests)
- `app/(mastery)/system/workflow-health/page.tsx` (stuck-state dashboard)

---

## Category 6 · Data integrity drift

**Data shape diverges from code expectations over time.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Orphan task without mission | (have to audit) | Conversation without messages, user without sessions |
| Brain memory category not in registry | drift signal in /system/coverage | tool-catalog drift |
| Empty shell records | Conversation with messageCount=0 | Mission with 0 tasks |
| Embedding count ≠ row count | vector drift | Photo embedding gaps |
| Stale wisdom from wrong fact | Promoted memory based on outdated truth | Beliefs derived from stale data |
| Zombie foreign-key refs | Pointing to deleted rows | Soft-delete leaks |
| Missing timestamps | 8 tables per `schema_debt.md` | createdAt/updatedAt gaps |
| Missing indexes | 22 tables | Slow query symptoms |
| JSON shape drift | `payload.X` vs `data.X` | Audit event payload variants |
| Enum value drift | Status string not in enum | Routing on stale status |

### Where it shows up

```
prisma/schema.prisma                   // 81 tables
lib/brain/categories.ts                // category registry
config/repos.ts                        // repo registry
lib/audit/                             // audit event shapes
Every Prisma write                     // create/update calls
Every cleanup cron                     // stale-purge scripts
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Nightly integrity scan | orphan + zombie-ref counts | > 0 |
| Schema diff vs prior | Prisma migration journal | unexpected delta |
| Embedding coverage check | row count − vectorized count | > 5% gap |
| Category-stats unregistered | `/system/coverage` count | > 0 |
| Slow-query log | `/system/slow-queries` | new shapes appearing |
| FK violation count | Prisma error rate | any |

### Prevention mechanisms

1. **DB-level FK constraints** · highest leverage · medium effort (one-time)
   - Audit which FKs exist vs which don't
   - Add `ON DELETE CASCADE` or `RESTRICT` per relationship
   - Migration = one-shot fix, ongoing protection

2. **Weekly integrity scan cron** · high leverage · low effort
   - Orphan detector (task without mission, etc.)
   - Zombie-ref check (FK pointing to deleted)
   - Output: `BrainMemory category=integrity_alert` row + Telegram ping

3. **Category registry CI lint** · high leverage · low effort
   - Grep code for `BrainMemory.create({ category: ... })`
   - Cross-check against `lib/brain/categories.ts` registry
   - PR-block on unregistered category writes

4. **Missing timestamps + indexes migration** · medium leverage · medium effort
   - Single migration to add missing fields per `schema_debt.md`
   - Already documented (Mar 28 audit), pending execution

5. **Schema audit log** · medium leverage · low effort
   - Already partial (`/system/schema-history`)
   - Extend: every migration tracked with rollback plan

### Existing infrastructure to extend

- `/system/coverage` (already extended for embedding coverage)
- `/system/schema-history` (migration audit trail)
- `schema_debt.md` (pre-baselined, ready to act on)
- `lib/brain/categories.ts` (registry exists, enforce via CI)

### New infrastructure to build

- `scripts/integrity-scan.ts` (orphan + zombie-ref detector)
- Migration: missing timestamps + indexes (per schema_debt.md)
- ESLint rule: `BrainMemory.create category` must be registry-known
- Cron: `weekly-integrity-scan` (every Sun at 03:00)

---

## Category 7 · Quality regressions

**Output quality degrades without functional break.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Generic-looking image | Venice recraft for marketing (fixed v10.0.333) | Wrong model picked for use case |
| Specificity drops | reply spec-density < 50/100 words | Cliche storms |
| Vision OCR misses key text | (could happen) | Receipt photos, signage |
| Suggestion staleness | Same suggestion 3 days running | Daily brief loops |
| Wrong-language hashtags | (haven't hit) | Mixed audience targeting |
| Brand voice drift | "Nick sounds generic" | System prompt slowly weakens |
| Cost creep | Silent model upgrade 4× cost | Provider routing degrades |
| Text rendering broken in images | seedream/recraft broken text | gpt-image-1 better but not perfect |
| CTA buried beyond last 25% | Critic catches but no auto-rewrite | Marketing copy loops |
| Hallucinated citations | Made-up doc references | Made-up customer names |

### Where it shows up

```
lib/ai/output-critic.ts                // existing critic
lib/ai/openai-image.ts (just shipped)
lib/ai/venice-image.ts (legacy)
app/api/ai/voice-to-content/route.ts
app/api/cron/morning-brief/route.ts
app/api/cron/eod-debrief/route.ts
Every model output                     // critic runs on each
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Critic score trending down | rolling 7d average vs prior 7d | drop > 10pts |
| A/B comparison delta | Gold-standard prompt vs fresh | drift > 15% |
| Cost telemetry spike | Per-turn cost cents | spike > 2× baseline |
| 1-tap feedback ratio | thumbs-up vs thumbs-down | < 70% positive |
| Operator regen rate | "do it again" frequency | > 10% |
| Specificity metric | spec-density per 100 words | < 30 |

### Prevention mechanisms

1. **Quality benchmark per use case** · highest leverage · medium effort
   - Gold-standard prompts per persona/intent
   - Run weekly, compare scores vs baseline
   - Flag drift > 15%
   - Lives in: `tests/quality/<use-case>.bench.ts`

2. **1-tap feedback loop** · high leverage · medium effort
   - You tap 👍/👎 on outputs
   - Trains routing weights
   - Already partial (feedback API exists)

3. **Model version pinning** · high leverage · low effort
   - No silent upgrades
   - Lock models in `lib/ai/provider.ts`
   - Explicit version bumps via PR

4. **Cost cap per turn** · medium leverage · low effort
   - Per-message cost cents threshold
   - Block over-budget calls
   - Surface in /chat as "cost guard fired"

5. **Critic score → auto-regen** · medium leverage · medium effort
   - When critic flags overall < 60, automatically regen once
   - Already partial (`shouldRegen` flag exists)

### Existing infrastructure to extend

- `lib/ai/output-critic.ts` (already runs on every turn)
- `feedback API` (extend with "great/bad" 1-tap)
- `/system/lens-stats` (per-framework quality lens)
- `/system/ai-cost` (cost telemetry)

### New infrastructure to build

- `tests/quality/<use-case>.bench.ts` (gold-standard prompts)
- `scripts/weekly-quality-bench.ts` (run + diff vs baseline)
- `app/(mastery)/system/quality-bench/page.tsx` (drift dashboard)
- 1-tap feedback UI in /chat (👍/👎 per message)

---

## Category 8 · Operational silence

**Jobs/processes fail without surfacing.**

### Failure modes

| Mode | Real example | Other surfaces |
|------|--------------|----------------|
| Cron stops running | (38 active, sometimes silent) | Brain bus consumer dies |
| Brain bus event pile-up | (have tail dashboard) | Audit log gaps |
| Notification fatigue | Too many alerts → ignored | Daily brief overload |
| Errors logged once, never paged | Single error log line, no escalation | Repeated same error never aggregated |
| Silent provider downgrade | Venice down → Anthropic, no banner | Buffer down → manual queue, no signal |
| Service degraded but health=green | Probe too narrow | Health check ignores latency |
| Backfill stuck at 70% | Never finishes | Migration pending forever |
| Synthetic check absence | No canary user | No end-to-end exercise |
| Telegram silent | Fired but no delivery confirmation | SMS without delivery receipt |
| Cost overrun without alert | $X budget exceeded | Per-day cost cap silent break |

### Where it shows up

```
config/crons.ts                        // 38 active crons
lib/brain/bus.ts                       // event consumer
lib/errors/*                           // error escalation
/system/health probes
/system/cron-diagnostics
/system/agent-traces
Telegram webhook delivery
```

### Detection signals

| Signal | How to measure | Threshold |
|--------|----------------|-----------|
| Heartbeat absence | last-run timestamp not advancing | > 2× expected interval |
| Queue depth growing | Brain bus pending count | > 100 events backed up |
| Error rate spike vs baseline | Per-route error rate | > 3× rolling 7d median |
| Synthetic-canary failure | Daily canary user run | any failure |
| Provider-health probe red | `/api/provider-health` | red > 2 consecutive cycles |
| Cost vs budget | Daily AI spend vs cap | > 80% |

### Prevention mechanisms

1. **Heartbeat per cron** · highest leverage · low effort
   - Every cron writes `last_run_at` on success
   - Sweep cron checks for stale heartbeats
   - Already partial (`/system/cron-diagnostics`), extend

2. **Synthetic canary user** · high leverage · medium effort
   - Daily run exercises full flow:
     - Login → /chat → ask Nick a question → expect reply → done
   - Failure = page operator
   - Lives in: `scripts/canary-user.ts`

3. **Error escalation ladder** · high leverage · medium effort
   - First N errors: log
   - Errors 5+ in 1h: brain memory + Telegram
   - Errors 20+ in 1h: page (severity 1)
   - Lives in: `lib/errors/escalation.ts`

4. **Provider-degradation banner** · high leverage · low effort
   - When provider falls back, show banner in /chat header
   - "Venice down — using Anthropic — replies 2× slower"
   - Lives in: chat header component

5. **Quiet hours contract** · medium leverage · low effort
   - Define: which crons MUST run between 02:00-04:00
   - Sweep verifies all ran
   - Alert if expected run didn't happen

### Existing infrastructure to extend

- `/system/cron-diagnostics` (already shows cron health)
- `/system/agent-traces` (already exists for AI lane)
- Telegram integration (use for paging)
- Brain bus events (use for escalation)

### New infrastructure to build

- `scripts/canary-user.ts` (synthetic full-flow exerciser)
- `lib/errors/escalation.ts` (severity ladder)
- Daily cron: `synthetic-canary-run`
- `/system/health` extension: per-provider degradation banner state

---

## Cross-cutting prevention infrastructure

These tools cut across multiple categories:

### A. **Pre-push gate (extend the existing 15-step)**
Add steps 16-20:
- 16: Contract pre-flight (Cat 1)
- 17: Sanitizer regression tests (Cat 2)
- 18: Detector corpus tests (Cat 3)
- 19: Idempotency test (Cat 4)
- 20: Workflow contract tests (Cat 5)

### B. **`/system/health-grid` mega-dashboard**
Single tile-grid showing every category's health:
- Cat 1 contracts: 13 actions probed, 12 green, 1 red (`leads_open` pending)
- Cat 2 sanitizer: 0 leakage events / 24h
- Cat 3 detectors: 4 misses / 24h, 60 corpus tests passing
- Cat 4 races: 0 duplicate-row incidents / 24h
- Cat 5 workflows: 0 stuck states
- Cat 6 integrity: 0 orphans / 0 zombies
- Cat 7 quality: critic avg 78/100 (vs 81 baseline · -4% · amber)
- Cat 8 silence: 38/38 crons heart-beating

### C. **Brain memory `category=glitch_capture`**
Every detected glitch (any category) writes to brain:
- Operator can review weekly: what's happening to the system?
- Patterns surface (e.g. "every time we deploy, Cat 4 race rises")
- Auto-correlation with deploys/migrations

### D. **Weekly system-health digest cron**
Sunday 09:00 — summarized to morning brief:
- 8 category counts
- New patterns this week
- Drift alerts
- Recommended actions

### E. **One-tap "this is broken" capture in /chat**
You see a glitch → tap a button → captures conversation context + writes to glitch_capture brain memory + spawns a fix-it task. Compounding feedback loop.

---

## Roll-out priority (recommended)

Per kaizen "small improvements continuously" + elon "delete what's not needed":

**Phase 1 · Foundation (1-2 sessions):**
1. DB unique constraint on `(conversationId, parentMessageId)` (Cat 4 · double-reply fix at the source)
2. `tests/ai/output-sanitizer.test.ts` corpus (Cat 2 · regression armor)
3. `scripts/contract-pre-flight.ts` skeleton (Cat 1 · catch bridge drift)
4. One-tap glitch_capture in /chat (cross-cutting · compounds)

**Phase 2 · Coverage (2-3 sessions):**
5. Integrity scan cron (Cat 6)
6. Synthetic canary user (Cat 8)
7. Per-detector corpus + tests (Cat 3)
8. Workflow contract tests (Cat 5 · post-publish, mission cycle)

**Phase 3 · Visibility (1-2 sessions):**
9. `/system/health-grid` mega-dashboard (cross-cutting)
10. Provider-degradation banner (Cat 8)
11. "Last good value + staleness chip" in HUD (Cat 5)

**Phase 4 · Quality (ongoing):**
12. Quality benchmark per use case (Cat 7)
13. Model version pinning (Cat 7)
14. 1-tap feedback loop (cross-cutting)

---

## Decision log

| Decision | Alternatives considered | Why this choice |
|----------|------------------------|-----------------|
| 8-category taxonomy | 5-category (lumped) · 30+ category (every failure mode) | 8 maps cleanly to root causes, not symptoms; matches existing observability surfaces |
| Per-category prevention list | Single global checklist | Lets each category's prevention be independently shippable + testable |
| Cross-cutting `/system/health-grid` | Per-category dashboards | One operator-facing pane shows ALL drift in one glance |
| `glitch_capture` brain memory | Separate logs / database table | Reuses brain infrastructure; ties into nightly continuity loop |
| Phase 1 = Foundation | Full parallel rollout | Each phase derisks the next; foundation gives the data layer to build on |

---

## Open questions

- Do you want me to write the prevention DESIGN doc next (specifying each piece in detail) or jump to executing Phase 1?
- Should `glitch_capture` go to brain memory or to a dedicated `OperationalIncident` table?
- Should the canary user run silently or surface in your morning brief?
- Cost ceiling for the canary + benchmark loops? They'll add ~$0.50/day in API costs.

---

_v1 · 2026-05-06 · started after the v10.0.331-333 fix wave._

---

## Appendix · v10.0.473-484 incident log (2026-05-08)

Five incidents from the bug-fix wave that closed the v10.0.442-484 sprint.
Each maps back to a category above; the lesson is the actionable
prevention rule.

| # | Symptom | Root cause | Category | Lesson |
|---|---------|-----------|----------|--------|
| 1 | Schema drift "applied" but rows missing `updatedAt` | `pnpm release:db` reported success locally but never reached prod Neon (auth/connectivity). Migration silently parked. | **Cat 6** · Data integrity drift | `prisma migrate status` against production DB is the source of truth — never trust local "release succeeded" messaging alone |
| 2 | /chat layout 2545px wrong on mobile | Earlier accessibility refactor (v10.0.469) added `position: relative` to `state-aura` keyframe wrapper — created a containing block for `position: fixed` descendants throughout the subtree | **Cat 7** · Quality regressions | Adding `position: relative` to a parent silently changes anchor for `position: fixed` descendants. Audit before adding to keyframe wrappers. State-aura reverted to direct box-shadow (compositor cost acceptable for the small set) |
| 3 | Image-gen "OpenAI billing limit" persisting after model swap | Next.js dev-server module cache held the old top-level import resolution; subsequent edits to `interceptors.ts` changed the alias but the dev process kept the stale module graph | **Cat 1** · Contract drift (variant) | Top-level imports in Next.js dev are sticky · use **defense-in-depth**: make the swapped module internally delegate to the new target so module-graph rot can't resurrect the old path. Pattern: `generateOpenAiImage()` now internally calls `generateVeniceImage()` |
| 4 | "help me come up with idea for picture" fired image-gen | `EARLY_IDEATION_NEG` regex required specific nouns alongside trigger phrases · "come up with" alone wasn't blocked when Nick was in image-classifier mode | **Cat 3** · NLU pattern misses | Ideation framing without specific nouns = **trigger-phrase-alone**. Loosened regex now matches `come up with`, `brainstorm`, `help me cook up`, `ideate`, `(1)…(2)…(3)…` numbered idea pattern |
| 5 | Mobile composer textarea 0px wide on iPhone | Audio + camera + ModePersonaChip + send button all permanently visible · consumed all 375px of available width · textarea collapsed | **Cat 7** · Quality regressions (UX) | Mobile composer chrome budget · every always-visible button competes with the textarea. Default to `hidden sm:flex` for non-essential controls; show on tablet+ only |

**Cross-cutting prevention upgrade:** the lessons above are now codified
in the `cohort-2026-05-08-eod-summary.md` "Lessons learned" section. New
glitches surfaced in subsequent sessions should reference both this
appendix and the cohort summary — both stay live as the reference set.

---

**Reconciled at v10.0.484** · 2026-05-08 EOD · this doc was reviewed against the live state of the OS in the v10.0.442-484 sprint reconciliation pass. See `docs/cohort-2026-05-08-eod-summary.md` for the sprint summary and which sections of this doc were touched. If a claim in this doc contradicts code reality, the code wins · open an issue.
