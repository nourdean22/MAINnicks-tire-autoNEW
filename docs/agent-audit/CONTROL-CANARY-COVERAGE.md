**Both landed 2026-08-22, together, as argued.** The widening, the wiring into `verify:hard`, the
programmatic seed and a canary shipped as one change, because each is useless alone: a widened script
nothing invokes is a dated warn tier with no caller, and wiring an unsatisfiable gate red-lines every
local push. Post-seed the gate reports `✅ all 20 autonomous-action rules have policies · ✅ all 74
active crons have policies`, exit 0, and the rule tier is HARD from the first commit — an earlier draft
made it WARN "until the seeder is switched", but that switch shipped in the same commit, so the warn
window would have been a 24-day hole for the exact defect the gate exists to catch.

### Three near-misses, recorded because the next session hits the same fork

Closing this gap had three ways to go wrong, none of which a test would have caught:

1. **Derived-from-declaration is not derived-from-policy.** Every rule in the registry — all twenty — declares
   `approval: "auto"`. Reading "derive policies from the rule list" literally — taking `approvalClass`
   from `rule.approval` — would have armed **17 lanes** to fire unattended (18 `send_telegram`, and the
   registry also holds 1 `send_email`, 1 `promote_memory`). The repo already encoded the answer: the
   lead-emailing rule is curated `"pending"` **despite** its own `approval: "auto"`. A rule DECLARES
   what it would do unattended; a policy RECORDS whether the operator has agreed to that. They are
   different facts and only one of them is an authorisation. **Which lane is protected by what is also
   easy to invert:** the 17 at risk are all telegram; the one customer-emailing lane is protected by
   *curation* winning last, not by the derived baseline.
2. **A seed script that runs on import.** `seed-policies.ts` calls `main()` at module load. A test
   importing it to assert completeness would have executed a **production write as a side effect of a
   unit test**. The derivation lives in `lib/automation/derive-rule-policies.ts` so it can be imported
   without that.
3. **A status-string rename that empties a queue.** Marking the bootstrap gap by changing
   `result: "pending_approval"` to a new value looked cleaner. `lib/services/action-receipt-feed.ts:73`
   classifies on that exact string — the rename would have silently dropped every affected row out of
   the approvals queue while every test passed. The marker rides in `payload` instead.

# Control canary coverage

**Measured 2026-08-22.** Referenced from root [`AGENTS.md`](../../AGENTS.md) -> *Ship the canary, not
just the control*. That file deliberately carries **no count** — counts rot faster than a policy file
gets re-read. This one is dated, and every number below is reproducible with the commands in
[Regenerating](#regenerating).

**The rule:** no hook, gate, lint, guard, alert or probe ships without a test that breaks it and
asserts it fails.

**Why a table and not a vibe:** a control that silently stopped working and a control that is passing
look *identical* from the outside. The only way to tell them apart is to break it on purpose and watch
it complain.

---

## The criterion — every canary must prove it can SEE the failure

This is the rule that separates a canary from a test that happens to be green,
and it is what the counted coverage in this document is counting.

**A test has to be able to see the defect before its silence means anything.**

The sharpest instance, 2026-08-23. The ET-clock canary asserts that the hour reads
17 under every process timezone. That assertion is *vacuous on its own* — it also
passes on a machine where the buggy call and the correct call happen to agree,
which is precisely the machine that does not have the bug. So it additionally
asserts that the BARE form genuinely differs by zone: `bareUtc === 21`,
`bareEt === 17`, and the two are not equal. Only then does the first assertion
carry information.

That is the general form of every blind instrument catalogued below, stated
positively:

| the instrument | what it could not see |
|---|---|
| `task_events` | a completion — the emitting call sites were unreachable |
| `error_logs` | a completion FAILURE — that path could not write to it |
| `cron_job_logs` | the alerters — they log nowhere in it |
| a text-scanning lint | a NUL-byte file — it reads as binary and is skipped |
| the ET-clock assertion, without its control | a UTC clock, on a UTC machine |

Each was wired, running, and structurally incapable of observing its subject, so
its silence got read as a clean result. The remedy is the same in every case and
costs one extra assertion: **break the thing, or plant the failure, and prove the
instrument goes red.** A canary without that step is a control nobody has shown is
connected.

### The rule in one sentence

> **The question is not whether a canary exists but whether the canary's subject
> includes the thing you're protecting.**

Stated after the sharpest same-day pair in the catalogue. `check:et-clock` and
`check:anti-slop` shipped in the SAME PR (#1809), are reported identically in PR
bodies, and were not equivalent:

| gate | what its canary looked at | would it have gone red on a regression? |
|---|---|---|
| `check:et-clock` | **executes the gate over the real tree** and asserts exit 0 | yes |
| `check:anti-slop` (until 2026-08-25) | the script's SOURCE text and its `package.json` wiring | **no** |

Both were green. Source-and-wiring assertions prove a gate EXISTS and is SPELLED
correctly; they cannot tell a working grep from a broken one. And the anti-slop
grep **was** broken: it required `next/font/google` to appear BEFORE `Inter` on
the line, so `import { Inter } from "next/font/google"` — the canonical Next.js
form, and the single most common way the AI-default font enters a codebase —
never matched. The gate printed *"no anti-slop UI patterns"* over the exact
pattern it names first, for as long as it had existed. Reading the source had
confirmed the check was present the whole time.

The fix is not a better regex. The fix is that the canary now RUNS the gate
against planted offenders, which is what surfaced the regex bug in the first
place.

**Applies to a category, not only an instance.** A gate's blanket exemptions need
the same treatment as its individual entries — the exemption is what a future
reader is most likely to remove as an oversight. `check-et-clock.mjs` states the
reasoning for each exemption class inside the script, not only in its PR.

### The purest blind instrument: a canary that matched its own import line

2026-08-25, found by mutation probe inside the session's own diff. A new
customer-facing SMS trigger is gated on `sms_global_pause`, and its canary read:

```
expect(body).toContain("getSmsPauseState");
```

The probe replaced the live call with a hardcoded `const pause = { readable:
true, paused: false }` — the exact shape of a gate that has stopped gating — and
the suite scored **GREEN**. The identifier was still present, on the `import`
line one row above. The canary was asserting that the module had been *imported*,
not that the gate was *consulted*.

This is the same mention-vs-execution failure that produced five false positives
elsewhere in the same session, where absence assertions matched their own
explanatory comments. It is worth separating because the direction is inverted
and therefore far more dangerous: a comment match makes a canary shout when
nothing is wrong and gets fixed within minutes because it is loud. **An import
match makes a canary stay silent when the subject is gone**, and nothing ever
prompts anyone to look.

The remedy is the general one, sharpened: **assert the INVOCATION, never the
identifier.** `toContain("await getSmsPauseState()")` and a regex pinning
`const pause = await getSmsPauseState()` both go red under the same mutation.
Stripping comments before an absence assertion is necessary and not sufficient —
an import statement is not a comment, and no `stripComments()` removes it.

### A green mutation probe indicts the probe OR the canary — determine which

Same session, immediately after. Two further probes came back green and the
reflex was to log two more blind canaries. Both were **the mutation being
inert**, not the canary being blind:

- Widening `/^([0-9])\1{9,}$/` to `{3,}` was supposed to make a real number
  wrongly match. It could not: the pattern is anchored `^...$`, so it still
  demands the *entire* string be one repeated digit. The fixture number was
  never going to match either way.
- A `perl -pi -e` substitution failed outright with *"Reference to nonexistent
  group"* and silently changed nothing, so the "mutated" run was the unbroken
  run.

Both canaries were fine; both probes were no-ops. Re-run against what the
assertion actually depends on — dropping the regex anchors, and replacing the
whole line rather than a fragment — and both went red.

**So the rule has two branches, and skipping the second is how a real blind
canary gets waved through as a bad probe:**

1. **Confirm the mutation applied.** Grep the file, or print the changed line,
   before believing the exit code. A substitution whose anchor did not match
   exits 0 and looks exactly like a passing test.
2. **Confirm the mutation targets what the assertion reads.** Loosening a
   constant the canary never inspects proves nothing. Ask which line the
   assertion would notice, and break *that*.

A green probe is never "fine". It is an unexplained result, and the two
explanations — *my probe did nothing* and *my canary sees nothing* — have
opposite remedies. Recording which one it was is the whole value.

**2026-08-26/27, two more instances that harden branch 1 into a mechanism.**
A sibling session's mutation probes all "passed" — and every one was a no-op:
the probe text went through a shell heredoc, the heredoc ate the backslashes,
and the regex that was supposed to break the subject never matched anything.
The session was one step from concluding the tests were blind when the tests
were fine. The same day, four of four first-draft canaries in another session
were blind in ways only an APPLIED mutation showed. Stated as the rule both
sessions now carry:

> **A probe that didn't actually mutate is indistinguishable from a canary
> that didn't fire.** Both render as green. So "confirm the mutation applied"
> is not a review step, it is a gate: hash the file before and after
> (`md5sum`), and REFUSE to report a probe result when the hash didn't change.
> An assertion-level equivalent already ships in this repo's newer canaries —
> `assert.notEqual(mutated, src, "the mutation did not apply — this arm would
> be vacuous")` — because a no-op edit makes the whole arm pass silently.

And the restore side of the same harness: it recovered files from backups
**keyed on basename**, and this monorepo has two `task-actions.ts`
(`lib/ai/agent-actions/task-actions.ts` and `lib/services/task-actions.ts`) —
the restore wrote one file's backup over the other and corrupted it.
**Basename-keyed backups are unsafe in a monorepo**: key backups by full
relative path or content hash, never by filename. A probe harness that can
corrupt its subject during RESTORE converts a read-only investigation into a
defect injection, which is strictly worse than the blindness it was probing
for.

### A number that measures which button you pressed

The family the 81.3-percent-saturated CRITICAL marker belongs to — a real
number, faithfully computed, describing something other than what the reader
assumes — gained its cleanest member on 2026-08-27 (#1926): the task timer.

`startTask` stamps `startedAt` and was wired end to end; completion converts
the stamp into `actualMinutes`. Except the three completion paths never
agreed about stopping the clock:

| finisher | what it did with the stamp |
|---|---|
| service, ONCE/PROMISE | banks the minutes, clears the stamp — correct |
| service, DAILY/WEEKLY | discards the minutes AND leaves the stamp dangling |
| agent (Nick) | never reads `startedAt` at all — silent loss |

Press Start in the UI, then ask Nick to close the task, and the elapsed time
is dropped while the stamp stays set on a DONE row — which any `startedAt`
reader sees as still in progress. The formulation worth keeping verbatim:
**the resulting rows aren't a sample of how long work takes, they're a sample
of which button you happened to use to finish — and nothing about the number
carries that bias, so it reads as measurement.** A partially-wired instrument
is worse than no instrument: absence is at least visibly absent.

Two sub-shapes inside the fix worth their own line:

- **A schema default that manufactures "measured".** `actualMinutes` has a
  NOT NULL default of 0, so an untimed completion is indistinguishable from a
  task started and finished inside a minute. The fix returns `addMinutes:
  null` — never 0 — for a never-started task, and `undefined` so Prisma SKIPS
  the column rather than overwriting minutes banked earlier. Zero is a real
  measurement; a default is not.
- **Same value, two surfaces, one honest.** `command-registry.ts` printed
  "${focusedMinutes}m focused" unguarded — Nick was told "0m focused" every
  day — while the UI tile beside it has always guarded the same value. When
  one consumer of a number is honest and another is not, the dishonest one
  inherits the honest one's credibility.

And the claim-discipline coda, recorded because #1926's own body records it:
the work had been flagged as **"blocked on a product decision — needs a
writer for `Task.actualMinutes`/`startedAt`"**. The writer existed and was
fully wired; no decision was needed. A blocker asserted from a plausible
story, refuted by reading the writer — the same shape as "not in the repo is
a fact about your search", applied to roadblocks: **an asserted blocker is a
claim, and the check is grepping for the writer before declaring it
missing.** (The one real product decision — whether DAILY repetitions should
accumulate minutes — was correctly left unmade.)

## Four shapes, and the heuristic each one defeats

Everything found on 2026-08-23 — across this session and the Brain session working the same estate —
collapses into four defect shapes. What makes them worth naming separately is not the symptom, which
is always "a thing that looks fine and is not". It is that **each one is invisible to a different
standard check**, so a reviewer running the obvious test comes away reassured.

| shape | what it is | the heuristic it defeats |
|---|---|---|
| **unwired control** | a gate, guard or probe that exists and is never called | *"does the code exist"* — it does, and it is correct, and nothing invokes it |
| **orphaned subject** | a reader with no writer, or a writer with no reader | *"grep for readers"* — there IS a reader; the producer is what is missing |
| **populated-but-unused** | a column that is full of values nobody consumes, or whose values are a placeholder | *"is the column null"* — it is not null, on every row |
| **blind instrument** | a control that is wired, running, and pointed at nothing | *"check the logs"* — the log is clean because it cannot record the thing |

**Blind-instrument instance, 2026-08-25 — a CI pass that was never attempted.** A deterministic
teardown throw in the statenour suite (langfuse SIGTERM handler `.catch` on a non-promise) was first
diagnosed as *"intermittent, ~50%"* because two PRs had passed the checks. Those two PRs touched only
`scripts/agent-os/**` — `turbo --affected` never ran the statenour suite for them at all. **They were
never exposed, not passing.** A green from a run that did not execute the relevant suite is the
affected-graph being blind to the question, not evidence about the defect; before citing a pass as
evidence, confirm the failing suite was actually IN that run's task list.

**On the third one, which is the newest and the easiest to miss: a column's name is a claim about its
contents, and a populated column is not a used column.** `NOT NULL` on every row proves that
something wrote a value. It does not prove the value means what the column is called, that anything
reads it, or that it varies. Three live examples, all found by opening the data rather than the schema:

- **`Mission.successMetric`** is populated on six of nine missions. Four of those six hold the
  sentence *"Catch-all for business tasks with no specific project."* That is not a success metric;
  it is a description, and specifically a description saying the mission has no success condition.
  A gate keyed on `successMetric IS NOT NULL` would have rendered a completion bar on exactly the
  missions that declare they cannot complete.
- **`Task.energyRequired` on AI-generated subtasks** was 12 of 12 MEDIUM — 0.00 bits — because the
  insert hardcoded the string. **With its denominator, which the finding is worthless without:**
  across all tasks the column is MEDIUM 82.7 / LOW 11.8 / HIGH 5.5 percent, about 0.82 bits. The
  column is alive and genuinely varies. Only the generator's rows were constant, and reporting the
  0.00 without the 0.82 would have condemned a working column.
- **The priority label** sits at 92.5 percent in its top two tiers. A scale that almost never uses
  its lower half is not ranking anything.

The right check is not `IS NOT NULL`. It is **entropy plus a consumer**: does the value vary, and
does anything branch on it? A constant is a placeholder wearing a measurement's name, and a column
nobody reads is a comment with storage costs.

**Where the depth lives.** This table is the canonical summary and is deliberately the only copy —
[`DEFECT-SHAPE-ORPHANED-SUBJECT.md`](DEFECT-SHAPE-ORPHANED-SUBJECT.md) carried a duplicate for part
of 2026-08-23 and has since replaced it with a pointer here, because two statements of one idea
diverge on the first edit. That file is the FIELD GUIDE: per shape it carries the probe that finds
one, the worked example with receipts, and the traps that defeated the first attempt at each probe.
It also holds the stated rules and the recorded decisions, including a measured NO on a 4 GB
migration. **This file counts by CONTROL and is the ledger; that one counts by SHAPE and is the
method.** The two numbers are not interchangeable.

A fifth shape lives there and not here, because it has no control to count: **the lying surface** —
a doc claim asserting a mechanism nothing verifies. Worse than an unwired control, which is merely
absent: a false doc claim actively stops people looking, and a false COMPLETENESS clause closes a
search outright. Worked example and probe are in that file.

**A caution that belongs beside this shape.** Every figure above is a ratio inside a filtered
population, and each is only meaningful next to its base rate — that is why both numbers appear on
the energy line. The house precedent is the 2026-08-08 call archive, where "72 percent of failed
calls are short" was quoted against an 18 percent base rate, and the ratio turned out to be nearly
definitional: a call where nobody spoke cannot be scored a success. It aimed the operator's next
priority at working code. Name the denominator, or do not quote the number.

## Counting unit

**One control = one thing that can independently stop working without anyone noticing.** A `verify`
chain of 16 links is 16 controls, because link 9 can rot while 1-8 stay green and the chain still
reports pass. The denominator below is what is enumerated here, not a claim that the enumeration is
complete — an unlisted control is not a covered one.

> **The unit is applied asymmetrically, and the asymmetry flatters this table.** `verify:hard` is
> counted as 16 because its links rot independently — but `check-adapters.mjs` is counted as **1**
> despite carrying dozens of assertions that demonstrably rot independently too
> (a raw count is deliberately omitted here: this document's numbers are gated by
> `coverage-doc.test.mjs`, which compares every stated check count against the CURRENT
> checker, so a historical figure would read as drift): this very PR found 6 of them inert
> because a file was missing from a fixture list, and ~21 more that a one-line change would have taken
> dark. Only 11 have a break-test today. Assertions still uncanaried include the `CODEOWNERS`,
> `apps/voice`, `Two apps share this repo`, `mcp_config.json` and the three MCP `requireMatch`es.
> Applied consistently the denominator grows, so the true figure is **lower than the ratio in the table below**. That is
> therefore an upper bound on coverage, not an estimate of it. It is left as-is rather than silently
> recomputed, because picking a new denominator mid-table is how a number stops meaning anything.

| Surface | Controls | With a canary | Notes |
|---|---:|---:|---|
| Claude policy **matcher** — `policy.mjs`, 17 rules / 144 denyExamples | 1 | **1** | Proven by `policy.test.mjs` (+ `nightShiftPolicy.test.mjs`, which probes the four night-shift rules through the real hook, 2026-09-15 — the fourth is the shell-write arm added after Codex #2335 P1 showed a redirect/tee/sed/cp/Set-Content could rewrite a judge past the Write/Edit-only rule) |
| Claude hook **wiring** — `pretool.mjs` exit-2, `settings.json` registration, `notebook_path`→`filePath` | 1 | 0 | **Never exercised.** See [proven ≠ connected](#proven-is-not-connected) |
| Claude hooks — `Stop`, `SessionStart` | 2 | 0 | `stop-check.mjs` fails **open** on its own bugs |
| agent-os parity — `check-adapters.mjs` | 1 | **1** | 142 checks, proven as of this PR |
| lefthook `pre-commit` | 10 | **1** | 3 of the 10 invoke a proven control (`nickstire-lint-brand`, `agent-os-verify`, `nickstire-lint-pii`). `nickstire-lint-pii` was wired 2026-09-16 and is the first job on this surface whose OWN hook wiring is canaried: `lintPiiHookWiring.test.ts` runs the real script twice — clean env AND under a valid `GIT_DIR`, which is what git actually exports to a hook — and mutation M23 (restoring the fail-open) leaves 5 of 12 green, the 5 being the clean-env cases. That is why the #2363 blindness survived for months here |
| lefthook `pre-push` | 1 | 0 | `turbo-build-affected` |
| statenour `verify:hard` | 16 | 0 | 12 are `tsx scripts/*.ts`, and `scripts/` is **excluded from tsc** — ratchet-gated by `check:scripts` since 2026-09-15 (its own row below) |
| statenour `check:policy-coverage` | 1 | **1** | Was wired into **nothing** for months; wired into `verify:hard` and canaried 2026-08-22 — see [the dead control](#the-dead-control) |
| statenour `check:scripts` | 1 | **1** | `scripts/` was excluded from every tsconfig the chain runs — 50 type errors and 5 dead imports on the day it was first measured (2026-09-15), including two smoke scripts importing a deleted component. Ratchet against `.scripts-tsc-baseline.json`, wired into `verify:hard`; `tests/scripts/check-scripts-typecheck.test.ts` breaks it first (a regression and a new file must FAIL), then proves the happy paths |
| statenour `check:memory-admission` | 1 | **1** | `brainMemory.remember()` is the admission gate where provenance, confidence and supersession are applied to a durable belief — and **172 direct write call sites across 123 files bypassed it** (vs 119 `remember()` sites), with **no write-side gate or allowlist existing at all** (measured 2026-09-18; the only `brainMemory` gate in the repo fences prompt READS). Ratchet against `data/memory-admission-baseline.json`, wired into `verify:hard`. Deliberately a FILE SET, not a count: a count ratchet passes the mixed case (remove one writer, add one, 123 -> 123, new bypass slips in). Removals are progress and never fail. Proven to bite LIVE in both directions — a fixture containing `prisma.brainMemory.create(...)` made it exit 1 and NAME the file; deleting the fixture made it clean. `tests/brain/memory-admission-ratchet.test.ts` pins the arithmetic incl. the mixed add+remove case and a CONTROL that an unchanged set passes |
| Night Shift **identity preflight** — `scripts/night-shift/identity-preflight.mjs`, fail-closed in `run.ps1` | 1 | **1** | The credential-level boundary: the headless run starts only as a separate identity that structurally cannot land a change on `main` (read/triage + fork flow, or write behind an ACTIVE ruleset). `nightShiftIdentity.test.mjs` refuses the operator's own identity, a write identity with no guard, admin/maintain, a missing token, and pins that `run.ps1` calls the preflight before `claude` and throws on its verdict (2026-09-15) |
| nickstire `verify` | 17 | **2** | `lint:brand-voice` proven by `lintGateFailClosed.test.ts`; `lint:curdate` (2026-09-23) proven by `scripts/lintCurdate.test.ts`, which breaks it both ways: planted sites must fail (every widened spelling, and a site after a `"*/*"` string, a `// …/api/*` comment, a regex holding `/*` and a SQL `-- ` comment), `--baseline` must refuse to launder a raised count, the real tree must pass, and the lexer must agree with the TypeScript parser on every literal character of `server/`. Its first proof was blind: the regex comment stripper hid 1,429 lines in 6 files, and the original six cases let 4 mutations live; 24 named mutations now each turn a case red. Plus a planted/clean canary pair in `adoption-gates.yml` that also requires the rule's headline and a widened spelling (`DATE(NOW())`) in stderr |
| Product alert paths — daily brief end-to-end | 1 | 0 | See [instance ten](#the-worked-example--instance-ten) |
| **This document** — its own derived numbers | 1 | **1** | [Instance twelve](#instance-twelve--this-document). Proven by `coverage-doc.test.mjs` |
| statenour `cron-heartbeat` **outcome lane** | 1 | **1** | Detects run-but-fail, which the silence check structurally cannot. Proven by `cron-heartbeat-failing-lane.test.ts` |
| statenour `ingest-reviews` zero-fetch assert | 1 | **1** | A 200 with an empty payload now throws. Proven in `tests/cron/ingest-reviews.test.ts` |
| `cron_job_logs.resultCount` producer | 1 | **1** | The schema can now tell a full ingest from a zero-result one, and `cron-manager-result-count.test.ts` proves it DISCRIMINATES rather than merely exists |
| Task-completion observability | 1 | **1** | The `completed` event, the failure log, and the queryable writeback — three blind instruments, all canaried and mutation-fired |
| Structural vs transient error copy | 1 | **1** | A missing relation no longer reads as a retryable hiccup; ordering is pinned by a canary that reproduces the month-long bug |
| Subtask next-action gate — `filterGeneratedSubtasks` + its call site | 1 | 1 | validator unit tests PLUS a wiring canary in `ai-tasks-decompose.test.ts`; deleting the gate block fails 6 |
| Mission progress end-state gate — `missionHasEndState` | 1 | 1 | behavioural render; swapping the ternary branches fails 3 where source-text assertions passed 11 |
| Witnessed-commitment resolver — opt-in guard on `emitTaskEvent` | 1 | 1 | asserts the completion emit does NOT set the flag, on both the ONCE and recurring paths |
| statenour `intelligence-brief` ingestion gate | 1 | 1 | behavioural; 6 mutations killed incl. TRANSPOSING attempted/ingested, which inverts the gate and survived the first source-text version 10/10 |
| statenour Inngest alert delivery receipt — `on-failure` | 1 | 0 | logs undelivered instead of claiming "notified"; no canary yet |
| Brief operator-queue gate — `deriveThreatLevel` + `stripInventedSeverity` | 1 | 1 | behavioural; 7 mutations killed, and the sanitizer has a positive control so it cannot mangle an ordinary brief |
| Source files are text — no NUL bytes | 1 | 1 | proves its own detector fires on a planted NUL BEFORE trusting any zero |
| statenour `check:anti-slop` | 1 | 1 | wired into `verify:hard` after running nowhere at all. **2026-08-25 · the canary now EXECUTES the gate** against planted offenders (purple gradient, Inter import, Roboto import) and proves the `anti-slop-allow` waiver is by-signature — a new hit in an already-waived file still fires. The previous arms read the script's source and its wiring only, and that blindness was hiding a live regex bug — see [the rule in one sentence](#the-rule-in-one-sentence) |
| statenour `check:et-clock` — bare `getHours()`/`getDay()` | 1 | 1 | forced-TZ test in a child process, plus a canary that reintroduces a bare reading and asserts the lint goes red |
| agent-os `check-gate-reachability` — every `check:*`/`lint:*` is invoked by something | 1 | 1 | the meta-gate: catches the **unwired control** shape at author time. Six arms incl. one that runs the checker against the LIVE repo, so a new orphan reddens `agent:verify` |
| GitHub Actions SHA-pinning — every workflow `uses:` | 1 | 1 | supply chain: **40 of 40 refs rode mutable tags** until 2026-09-09, two of them third-party — the class `tj-actions/changed-files` belonged to (CVE-2025-30066, ~23k repos). Proven by `actionPinning.test.mjs`: a mutation unpins one LIVE ref and asserts that exact line is named, and a positive control cross-counts `uses:` lines against an independent counter so a clean verdict cannot come from a scanner that matched nothing |
| Workspace roster is documented — every `apps/*` + `packages/*` package appears in the README | 1 | 1 | the **invisible-capability** shape: 6 of 9 packages were undocumented for months, so a session grepping the README concluded they did not exist. Proven by `workspaceDocCoverage.test.mjs` — deletes a real package's name from the README and asserts THAT name is reported, plus a roster positive control so "documented" cannot mean "enumerated nothing" |
| Container scan — the runtime OS layer Dependabot cannot read | 1 | 1 | `dependabot.yml` declares `npm` + `github-actions` only, so **imagemagick, ffmpeg, chromium and 14 pinned pip packages** in the two Railway-built images had no watcher at all. `container-scan.yml` scans a layer DERIVED from the real Dockerfile (`extract-runtime-oslayer.mjs`, 7 canaries incl. the `\`-continuation case that would silently drop every package name). Canaried twice: an EOL `alpine:3.10` must report findings (proves the vuln DB loaded) and each leg must enumerate >0 packages (proves it is looking at a real image) |
| nickstire **hidden holdout** — `scripts/proof/unpack-holdout.mjs` + `holdout-summary.mjs` + the runner's holdout mode | 1 | **1** | The evaluator the optimising agent cannot see. `shared/proofHoldout.test.ts` (10) proves the leak surfaces are shut — a holdout's title is its id only, an assertion label names only the oracle's KIND, a failure record carries a fixed phrase — and that an ABSENT holdout is posted as `unmeasured`, never as a pass (the silent-instrument shape, on the one instrument whose silence nobody would notice). Replayed live 2026-09-15: 3/3 pass in holdout mode, nothing written under the uploaded artifact |
| statenour **Repo Time Machine** — `lib/services/proof-timeline.ts` + `/api/proof/timeline` | 1 | **1** | Groups the proof lane on the commit the site actually SERVED when judged. `tests/services/proof-timeline.test.ts` (8): newest-first grouping, latest run wins, failures unioned, deltas name what was fixed and what broke, an unmeasured holdout never becomes "zero failures" in a delta, garbage payloads cannot take the page down, P2021 degrades and other errors surface |
| statenour **ActionAttempt reclaim CAS** — `beginAttempt` in `lib/services/action-attempts.ts` | 1 | **1** | The claim-before-act shape: two racers reading the same expired row must yield ONE claim. `tests/services/action-attempts.test.ts` drives a store whose `updateMany` evaluates the WHERE against the current row (no hard-coded counts): the two-caller race returns one `claimed` and one `duplicate`, and the RENEWAL race — another caller moves only `holdUntil` between the read and the swap — returns `duplicate` with nothing reclaimed. Dropping the deadline from the predicate flips the renewal race to `claimed` (Codex, #2343/#2345) |
| **Total** | **76** | **30** | **39.5 %** |

---

## Proven — the ones that fire

> The summary table above is the count; this section shows the shape. An earlier
> heading said "the three that fire" and went stale the moment the total moved,
> because the number canary matches DIGITS and cannot see a spelled-out word.

| Control | Guards | Canary | Runs in |
|---|---|---|---|
| `config/agent-os/policy.json` (17 rules, 144 denyExamples) | destructive git/DB/install commands | `scripts/agent-os/policy.test.mjs` — *"every denyExample is actually blocked, **by its own rule**"* | `pnpm agent:verify`, CI |
| `scripts/agent-os/check-adapters.mjs` (142 checks) | adapter parity, line caps, line length, `@`-imports, stale claims | `scripts/agent-os/adapters.test.mjs` — 24 tests: the prior 17 plus 7 Nour Command routing/file-presence canaries | `pnpm agent:verify`, lefthook, CI |
| nickstire `lint:brand-voice` | claim safety on staged content | `server/lintGateFailClosed.test.ts` — *"an UNREADABLE staged diff exits non-zero and prints NO pass line"* | `pnpm run verify`, lefthook |
| nickstire `lint:curdate` | no NEW calendar date computed from the UTC DB clock in `server/` SQL (the NT-009 class) | `scripts/lintCurdate.test.ts` — *"a site planted after the real shopDriverMirror.ts Accept header is counted"*, plus a case that holds the lexer to the TypeScript parser on every scanned file | `pnpm run verify`, `test.yml`, `adoption-gates.yml` |
| `scripts/agent-os/check-gate-reachability.mjs` | that every `check:*`/`lint:*` script is invoked by CI, lefthook, or a `verify` chain | `gateReachability.test.mjs` — 6 arms: an orphan is named, three wirings are spared, the alias/fixer rules are proven not to swallow the real 2026-08-23 defect, the allowlist is checked for stale entries, a blinded copy of the checker is required to pass differently, and **arm 6 runs the checker against the live repo** so a new orphan reddens CI | `pnpm agent:verify`, CI |

| `scripts/agent-os/actionPinning.test.mjs` | that every `uses:` in `.github/workflows/**` names a full commit SHA, not a movable tag | itself — it is control and canary in one file: one test asserts the live tree is clean, a second unpins a ref in a REAL workflow and asserts that line is named, a third cross-counts `uses:` lines against an independent counter so "clean" can never mean "saw nothing" | `pnpm agent:verify`, CI |

They share one shape worth copying: **they break the control AND assert an unbroken run still
passes.** Without that second half, a control that failed unconditionally would score 100 %.

## Unproven — the rest

| Control | Guards | Why it matters that it is unproven |
|---|---|---|
| `pretool.mjs` **hook wiring** | that a matched rule actually blocks the call | The matcher is proven; the wiring that runs it is not. See below |
| `stop-check.mjs` (Stop hook) | uncommitted changes on `main` | Fails **open** on its own bugs (`pretool.mjs:9-12`) — silence is not a green |
| `graphify-session-context.ps1` (SessionStart) | injects graph context | A silent failure degrades every later decision invisibly |
| statenour `check:env`, `check:runbooks`, `check:prompt-injection`, `check:audit-deps`, `check:lint-baseline`, `check:raw-sql`, `check:crons`, `check:soft-delete`, `check:get-auth`, `check:mutations:strict`, `check:stale-docs`, `prompt:size-check` | 12 distinct invariants | `tsconfig.json` excludes `scripts/`, so **none of these is typechecked**; a broken import passes every gate and fails only at runtime |
| lefthook `pre-commit` x10, `pre-push` x1 | staged lint, typecheck, secrets, build | Git-level, applies to **every** agent and human — the widest blast radius and the least proof |
| nickstire `verify` — 15 of 17 links | PII, routes, prerender, migrations, SQL (now incl. `lint:cron-wiring`, its own canary unwritten) | Only `lint:brand-voice` and `lint:curdate` are proven |
| Daily-brief delivery path | that the operator actually sees a P1 | Instance ten, below |

---

## The worked example — instance ten

The strongest entry, because every per-stage instrument reported success.

**Detection ✓ · composition ✓ · persistence ✓ · push ✓ · routing ✓ · render ✗** — as it stood for 18 days.
The render defect is now fixed (#1781); see **Status** below. What is still missing is the canary.

The loose version — *"the alert never reached him"* — is **wrong**, and less useful than the truth:
**the alert reached the operator 18 times and the destination contradicted it 18 times.**

| Phase | Window | Span | What was true |
|---|---|---:|---|
| Latent | 2026-06-23 -> 07-29 | 37 d | Defect present in the page's **first commit** (`5999d24f2`); no briefs existed, so nothing revealed it |
| Active | 2026-07-30 -> 08-22 | 24 d | **24 daily briefs** composed and persisted — every one unrenderable |
| Contradicted | 2026-08-04 -> 08-22 | 18 d | **18 push deliveries**, `sent > 0`, `failed: 0` every time, into a page reading "No Briefing Generated Today" |

**Cause:** the page read `data.brief` from an `apiHandler`-enveloped `{ok, data: {brief}}` body.
`apiHandler` shipped 2026-05-17, five weeks *before* the page — so this was never drift between two
evolving things, it was a consumer that never matched a contract that already existed. The fetch line
was byte-identical at birth and after #1353 (2026-08-04): across those 60 days the screen rendered a
brief exactly **zero** times.

> **Status: the render defect is FIXED.** #1781 (`ec69d8347`, 2026-08-22) changed the page to
> `const payload = body?.data ?? body;` — it is closed on the merge base this table is written against,
> and the tenses above are historical. An earlier draft of this section said "the screen has **never
> once** rendered a brief" in the present tense, describing as live a defect the author had already
> fixed. In a document whose stated purpose is measurement honesty, that is the same class of error as
> the reconstructed receipt below it, so it is recorded rather than quietly amended.
>
> **The entry stays in the table, and its row still reads 0.** What was fixed is the *bug*. What is
> still missing is the *canary*: nothing asserts end-to-end that a composed brief reaches a rendered
> page. The identical failure could recur tomorrow on any of the other panels reading this envelope,
> and every per-stage instrument would stay green exactly as it did for 18 days.

**Evidence:** `"AuditEvent"` rows where `eventType = 'push_sent'` — and `push.ts:289` writes that type
only when `sent > 0`, so the row itself is the proof. Zero `push_undelivered` rows exist.

**The lesson this instance teaches, which no single-stage test can:** every layer had a success signal
and every layer was telling the truth about its own hop. Cron logged success, the composer logged
success, push logged `failed: 0`. **End-to-end proof is not the sum of per-stage greens.**

> **Base-rate note.** `push_sent` totals 2,322 rows, but **2,286 of the trailing 14 days landed on
> 2026-08-20 alone** — the #1735 notification recursion (`push.ts:73`: 2,279 CRITICAL pushes in ~5.5
> hours). Quoting the headline total as routine volume would be wrong by ~50x. The 18 figure above is
> the brief series specifically.

---

## Proven is not connected

A canary proves a control *fires*. It does not prove the control is *wired*, and it does not prove the
control *measures the right thing*. Three states, not two — and the last two both produce green:

| | fires when broken? | actually invoked? | measures the right thing? |
|---|---|---|---|
| **Proven** | yes | yes | yes |
| **Unproven** | unknown | — | — |
| **Proven but unwired** | yes | **no** | — |
| **Proven but blind** | yes | yes | **no** |

Two live examples, both found while writing this table:

**Proven but unwired — the policy matcher.** `policy.test.mjs` is the best canary in the repo: it
asserts every `denyExample` is blocked *by its own rule*. But it imports `policy.mjs` directly and
**never spawns `pretool.mjs`**. So the matcher is proven and the hook that runs it is not — not its
exit-2 behaviour, not its registration in `.claude/settings.json`, not its `notebook_path`→`filePath`
mapping (which the test's own comment names as pretool's job). Delete the hook's registration and every
test still passes. That is why the two are counted as separate controls above.

**Proven but blind — the line cap.** `requireThin` has a canary in `adapters.test.mjs`
(*"line caps are real — a fat adapter is rejected"*), and it genuinely fires. It counts **lines**.
On 2026-08-22, seven wrapped passages in this repo's root policy file were reflowed into single long
lines to make room for new content. Not one word was removed — the reflow freed lines without
reducing anything an agent loads — and every gate stayed green throughout.
Lines are not the context cost; bytes are. A gate that fires reliably on the wrong metric is more
dangerous than one that never fires, because it emits positive evidence of a constraint that is not
constraining. The repo's own audit proposed a max-line-length canary for exactly this and it was never
built. **It is now**: `forbidLongLine` rejects any non-table line over 140 chars, with canaries in both
directions (a 200-char prose line must fail; a wide markdown table row must be spared). The line cap
itself was also off by one — `lineCount` counted the trailing empty string after a file's final
newline, so `cap 200` silently meant 199 for every newline-terminated file. Fixed, and proved at the
boundary. Root `AGENTS.md` is no longer an exception: **200 lines, the same cap as the per-app files**,
reached by 21 verified relocations rather than by moving the number.

---

## The dead control

The failure class in its purest form: **a control that works correctly, whose hard-mode ratchet expired
2026-05-10, and which has never once run inside a gate.**

`apps/statenour/scripts/check-policy-coverage.ts` was defined as `check:policy-coverage` in
`package.json` and invoked by **nothing** — not `verify:hard` (21 links today; it was 16, then 17, then 18, then 19, then 20, and none of
them was this), not `.github/workflows`, not `lefthook.yml`. Run by hand on 2026-08-22 it exited **1**
immediately. Verbatim, not reconstructed:

```
  ❌  3 active crons missing AutomationPolicy entry:
     · cron.tool-description-rewrite
     · cron.outcome-harvest
     · cron.conversation-compile

  fix: add the cron to scripts/seed-policies.ts (or run the script if
       it's already declared) — `pnpm tsx scripts/seed-policies.ts`

  emergency override: POLICY_GATE_SOFT=1 to demote to warning.
```

Three crons have been running unaudited for months behind a gate that would have named them on the
first push. Nobody weakened it, nobody disabled it — **it was simply never connected**, which is
indistinguishable from passing right up until someone runs it.

> **An earlier draft of this section printed a receipt this script cannot emit** — it showed a second
> `⚠️ 17/20 autonomous-action rules` line, ordered above the cron block, from a since-reverted local
> change. Both details were wrong: the code prints the rule tier *first*, and that tier is not on this
> branch at all. A reconstructed receipt inside a document arguing that receipts must be real is the
> same defect the document is about, so it is recorded here rather than quietly corrected.

**The same gate is also blind, separately from being unwired.** It enumerates only `cron.*`. The
autonomous-action engine registers **20** rules (`listRuleNames()`), and `scripts/seed-policies.ts`
carries **4** `autonomous-action.*` ids of which only **3** match a real rule name — so **17 of 20
rules have no policy**, and the fail-closed engine parks every match as pending forever. That figure is
derived from source, not from this script: it cannot see rules, which is the point. A fourth seeded id,
`autonomous-action.auto_score_applicant`, matches **no** rule in `RULES` — a dangling policy row.

**Why neither the widening nor the wiring is in this PR.** Connecting the gate turns `verify:hard` red
for every session sharing this checkout, and the remedy — seeding the missing policies — is a
**production database write**, a protected operation needing explicit operator authorisation. A widened
script with no caller is no better: a dated warn tier inside something nothing invokes is the same
failure with a timestamp on it. Both land with the seed, together, with a canary. Shipping a gate you
know is red, softening its tier to make it green, or adding an uncalled one, are three wrong repairs.

---

## Key presence is not key validity — a credential as a blind instrument (2026-08-27)

`OPENAI_API_KEY` on statenour-web prod is **present and invalid**: a 164-char `sk-proj…` value
that every presence check passes — provider registration, env validation, "is the lane
configured" — while every actual call returns 401. The lane died silently; the failure surfaced
as feature-level errors in the TTS session (streaming read-aloud dead in prod), not as any
guard firing. Independently corroborated the same day: the identical key from the local `.env`
against `api.openai.com/v1/models` → **HTTP 401** (measured 2026-08-27; the first probe of the
day got 401 from a *mis-extracted 4-char fragment*, which proves nothing — a 401 from garbage
and a 401 from the real key are the same rendering, so the receipt only counts with the full
key shown extracted).

**The generalisable rule: key presence is not key validity — verify a provider lane with one
live call.** An env-presence check is Stated Rule 1's canonical failure applied to config: it
asserts a string exists, and can never observe whether the credential behind it works. Presence
checks keep passing forever after a key is revoked, expired, or rotated upstream; nothing in the
process distinguishes "configured" from "configured and dead."

**The probe:** per provider lane, one cheap authenticated no-op (`/v1/models`, a whoami, a
1-token completion) — at deploy, or on a daily canary that pages. A dead key should be an alert
with the lane's name on it, never a user-discovered 401 three layers up. Rotation itself is
operator-side (the app AGENTS.md header carries "prod OpenAI key DEAD — rotation pending").

---

## The worked example — four blind instruments and a wrong clock

2026-08-23. The operator reported that completing a task threw an error. Diagnosing it meant asking
the system what had happened. **Every instrument reached for was structurally incapable of answering,
and each one's silence was nearly read as evidence.**

**Structurally blind means the instrument could not have answered even if the system were on fire.**
Not "it happened to be empty" — empty is the symptom. Each row below names the mechanism.

| instrument | what it was asked | why it was STRUCTURALLY unable to answer |
|---|---|---|
| `task_events` | did the completion land? | Two emitters of `kind: "completed"` existed — and neither could fire. One (`tasks.ts:1038`) is annotated in-source as UNREACHABLE, because every real TODO→DONE PATCH short-circuits into `checkTask` before it. The other is voice-only. The spine every UI route funnels through emitted nothing, so the log had **zero** completions across 294 rows. |
| `error_logs` | did the completion fail? | The completion path had no write to it at all. `checkTask` threw `ServiceError`, the tRPC handler converted it to a `TRPCError`, and the catch recorded nothing — so a failed completion could not produce a row by any route. Querying it and finding nothing was querying a table the feature was not plumbed into. |
| `reality_gap_writeback_failed` | did the side-write fail? | Exactly **one** reference repo-wide: its own writer. A log line nothing reads is not an instrument, it is a comment that costs disk. |
| `api_request_logs` (Brain session) | which requests failed? | **Mechanism corrected 2026-08-23** — the first statement here ("it does not instrument the task routes") was itself an invented mechanism, and the Brain session shipped the same error before measuring. `/api/tasks/*` **is** `apiHandler`-wrapped (`route.ts:20,30`; `[id]/route.ts:7,16,22`). The real blinding is twofold: routes that bypass `apiHandler` entirely (the pattern documented at `diagnose-chat.ts:17-20`), and a **10% production sampler** (`http.ts:241`: `duration_ms > 1000 \|\| Math.random() < 0.1`). The empirical claim held — `/api/tasks%` returns **0 rows, all time** — but the stated reason was wrong. A ledger of blind instruments that misreads an instrument's blinding mechanism is the shape it names. |
| the clock | when did this happen? | Inferred from the newest row in a query result instead of read. A write **thirteen hours old** was reported as six minutes old. |

The shared mechanism is worth stating flatly: **in every row, the query returned an empty set and the
empty set was read as a finding about the world.** It was a finding about the instrument.

**The clock is the one to sit with.** It is not a control, and no canary would have caught it — but it
is the same error as the other three: taking a fact off an instrument that was not measuring it. The
newest row in a result set is not the present. It nearly caused a healthy migration to be rolled back.

> **The rule it produces:** during a live diagnosis, establish the current time **explicitly** — from
> the database or the system — before any reasoning about recency. Never infer "now" from data.

**An absence is only evidence if the instrument can record a presence.** Before reading silence as a
finding, prove the thing can speak: plant a positive control, or check that the value has ever been
non-empty. Three times in one hour that check would have changed the conclusion, and once it did —
the "no completion in three days" inference was withdrawn after the operator challenged it, because
absence of successes is not evidence of failure.

**The defect these share is not "unwired".** A wired control that cannot observe its subject reports
green forever and is indistinguishable from a healthy system. That is the fourth category, alongside
proven, unproven, and proven-but-blind: **wired, running, and pointed at nothing.**

### What was fixed

- `checkTask` now emits `kind: "completed"`, so the append-only log records the most important event
  in a task's lifecycle for the first time. **The first attempt at this fix was itself blind**, and
  the correction is the more useful record: the emit went in near the end of the function, and the
  DAILY/WEEKLY branch returns roughly three hundred lines before it — so every recurring completion,
  which is the lane `/missions` routes habits through, still emitted nothing. The test that
  "proved" it asserted the string `kind: "completed"` appeared between two function declarations,
  which is true whether or not the line is reachable. It was green over a live blind spot. It is now
  a behavioural test that drives `checkTask` and asserts on the emit; deleting the recurring emit
  turns it red.
- Wiring that emit also revealed that the voice route already emitted the same event immediately
  after calling `checkTask`, under a comment reading "checkTask does not emit a TaskEvent itself" —
  true when written, falsified by this change. The two payloads differ, so the 60-second idempotency
  key would not have collided and every voice completion would have written **two** rows into a table
  that `getDoneTodayCount()` counts. Fixing a silent instrument nearly produced a double-counting one.
- The completion mutation logs its own failures — a 4xx at `warn`, anything else at `error`, so
  operator typos do not train the reader to ignore the channel.
- The swallowed reality-gap writeback still swallows (it must never break a completion, and
  verifiably cannot — there is no transaction in that file) but now also lands somewhere queryable.
- Each is canaried, and each canary mutation-fires: remove the emit, the logging, or the queryable
  write, and the suite goes red naming the specific loss.

### The month-old error underneath it

The actual thrown error was `42P01 relation "drift_alerts" does not exist` — **first seen a month
earlier, 814 occurrences, nobody investigating.** Two un-typechecked raw queries outlived the Prisma
model they read; the feature itself had migrated to BrainMemory-backed storage, and the table was
dropped without pruning its readers. `safeQuery` swallows only quota errors, so this failed the entire
hub payload rather than degrading one sub-rollup.

It went uninvestigated for a month because the operator-facing copy classified it as **"Database
hiccup · try again in a moment"** — the transient branch matched on the word `prisma`. A missing
relation is structural: retrying can never fix it. Structural errors are now classified before
transient ones and say so plainly, because error copy that calls a broken schema "flaky" is an
instrument that misreports its own reading.

---

## Known landmines — armed, disclosed, not defused

Things a canary now detects but that nobody has fixed. Each names its trigger condition, because a
hazard described only as "we should clean that up" gets cleaned up by someone who does not know what
it was guarding.

### `autonomous-action.auto_score_applicant` — a live `auto` policy for an automation that does not exist

There is an enabled AutomationPolicy row with `approvalClass: "auto"` whose `name` matches **no rule
in `RULES`**, and whose declared trigger `/api/webhooks/applicant` is **not a route** — `app/api/webhooks/`
contains only `inbound-crm`, `make`, `nickstire` and `stripe`.

**Trigger condition, spelled out.** The day someone implements a rule named `auto_score_applicant`:

1. The derived baseline in `lib/automation/derive-rule-policies.ts` would give it `"pending"`.
2. The curated entry in `scripts/seed-policies.ts` is spread **last** and wins — `"auto"`.
3. On re-seed, `upsertPolicy`'s `update` block **omits `approvalClass`**, so the existing `auto` row
   survives untouched.

The rule is born **armed**, unattended, with no operator decision anywhere in the loop — and every
existing test stays green, because completeness runs one way (every rule has a policy) and nothing
asserted the inverse (every curated policy names a real rule).

**Status:** the inverse direction is now asserted in `derive-rule-policies.test.ts`, with this id in a
named `KNOWN_ORPHAN_POLICY_IDS` allowlist. That stops NEW orphans; it does not defuse this one.
Defusing it means deleting or disabling a production row — a protected operation, operator-only.

### The witnessed-commitment resolver — dormant code that an observability fix nearly executed

`lib/brain/task-events.ts` is documented at the top as *"Append-only. Never updated, never deleted."*
It is not. When `kind === "completed"`, it loads **every** ACTIVE `WITNESSED_COMMITMENT` agenda item —
no `taskId` filter, no `take` — and sets any whose title matches the task's title, in either
direction, to `RESOLVED`. No confirmation, no undo.

**It had never run.** Measured 2026-08-23 against prod: `task_events` held zero `completed` rows ever,
and `agenda_items` held zero rows in any RESOLVED state. Wiring the first working completion emit
would have been the first execution of that code — in production, against 35 live commitments, several
of them personal.

This is the shape recorded in `statenour-publish-status-arc-2026-08-03`: **repairing a no-op re-arms
every dormant path behind it.** The emit was reasoned about as a log write. It was a mutation.

Simulated read-only before anything shipped, so the decision has numbers attached: 5 matches across
110 tasks x 35 commitments, all five genuine title-identical pairs, and **zero of the five matched on
the intended `meta.taskId` link** — the fuzzy title branch does all of the work. Nothing matched a
recurring task, so nothing would fire daily today.

**Status: gated, not fixed.** The resolver is now opt-in via `resolveWitnessedCommitments` on the
event input, default false, and no caller sets it. That preserves the observed behaviour exactly — it
has never fired and still will not — while making arming it a deliberate decision rather than a side
effect of adding a log line. Whether the operator wants completions to resolve commitments, and
whether a bidirectional title `includes()` is the right matcher for that, are product questions.
A canary asserts the emit does not set the flag.

### ET-weekday reading on UTC-anchored date arithmetic — named, open

The 2026-08-23 clock fix converted 57 sites to `hourET()` / `weekdayET()`, which
closes the fires-a-day-early class. It did NOT close everything, and the residual
has a specific shape worth writing down so it does not become a second
74%-adopted situation:

```
d.setDate(d.getDate() - weekdayET(d));
```

The READING is ET; `getDate()` and `setDate()` are still UTC-anchored. Between 8pm
and midnight ET the two disagree about which calendar day it is, so a start-of-week
or day-offset computation can still land one day out inside that four-hour window.
Closing it needs an ET-anchored date helper — `startOfWeekET`, `addDaysET` — which
is a larger change than the reading swap and was deliberately not bundled.

`check-et-clock.mjs` does NOT catch this: the call it forbids is already gone. A
gate that passes over a known residual is fine as long as the residual is written
down; this is that writing-down.

### A test that fails for a reason unrelated to its subject

`auto-learn-llm.test.ts` mocked `@/lib/utils/datetime` with only `today`. The day
the file under test imported `hourET` from the same module, the helper was
`undefined`, the call threw inside an async path, and three tests failed with:

> expected "spy" to be called 1 times, but got 0 times

A message pointing nowhere near the cause. This is a blind instrument pointed the
other way: not a green over a real failure, but a red that describes the wrong
thing, which costs the same debugging time and erodes trust in the suite faster.
Fixed by making the mock partial via `importOriginal`, so the next import added to
the subject cannot silently break it.

### Two disclosures carried forward, still open

- **The stale-window multiplier** in `apps/worker/src/scheduler.ts`. The FORM (a threshold expressed
  as a count of intervals) is grounded in incident.io's "missed tolerance". The multiplier itself and
  the `+ 5` minutes are judgment calls, marked as such in-code. Prometheus is explicitly named there
  as the WRONG precedent so nobody re-adds it: its primary docs use a fixed five-minute lookback
  delta, not a multiple of the scrape interval.
- **The `policyBootstrap` marker** written by the autonomous engine when a lane has no policy row has
  **no reader**. Nothing queries it, nothing surfaces it, no test covers it. The real protection is
  the coverage gate now wired into `verify:hard`; the marker is belt-and-braces that nobody has
  buckled. Surface it in the approvals UI or delete it.

---

## Instance twelve — this document

**The rule caught its own defining document.**

This file argues that no control ships without a canary. It shipped carrying roughly fifteen
hand-written derived numbers — check counts, test counts, chain-link counts, line counts, a coverage
ratio — and **nothing checked any of them.** By the taxonomy in [proven ≠ connected](#proven-is-not-connected)
it was an unproven control: a claim nobody verifies is a claim that rots.

It rotted immediately, and in the most ordinary way available. Every fix made while writing the PR
invalidated a number written earlier in the same PR. The check count moved **123 → 131 → 133 → 135** as
assertions were added, and the prose kept whichever value happened to be true when the sentence was
typed. A third adversarial review found six such numbers by hand. A fourth would have found more,
because the fixes for the third invalidated others — an unbounded proofreading loop, doing by hand the
one job a gate does perfectly.

**The fix is the thesis applied to itself.** `scripts/agent-os/coverage-doc.test.mjs` recomputes every
derived number from the command or source that produces it and fails when this prose disagrees. It is
itself canaried in three directions: corrupt one number and the audit must name it; break the table's
arithmetic and it must fail; and **delete a claim rather than correct it** and it must still fail —
otherwise the cheapest way to fix a wrong number would be to remove it.

That last case is the one worth copying. A number-checking gate that only compares present numbers
teaches people to delete numbers.

---

## The irony, recorded

**This system asked for this rule about itself.** Its 2026-08-22 brief recommended *"a health-check
heartbeat to every external feed so a zero-result cycle auto-pages"* — a canary, derived independently,
by the same brief that ten cycles running could not be read. Fixing its self-awareness gaps and
shipping the canary rule are the same project.

---

## Merged is not deployed — the instrument I was reporting with

2026-08-23. Four PRs merged and four SHAs reported to the operator as though a
SHA meant he had the fix. He then said "there hasn't been any UI changes", and
nobody could answer him, because **nothing in the reporting loop observed
deployment at all.**

The SHA is a fact about the repository. What the operator cares about is whether
the running site has the change. Those are different claims, and for hours the
first was being offered as evidence of the second. Same shape as everything else
on this page: an instrument that cannot observe the thing it is being used to
assert, reported with confidence because it was easy to read.

**What made it visible** was checking the deployed site rather than the branch —
Discover reading 2 where it read 56, the 237 restored rows carrying their
provenance line. That confirmed statenour deploys from `main`, which nobody had
verified today either; it was assumed by everyone including me.

**The verification that worked, and why it generalises.** `7541e79a2` was
confirmed live by data, not by a dashboard: `task_events` held 8 `completed`
rows, newest 13 minutes old, in a table that had **zero, ever**, before that
commit. Four of the eight came from the recurring branch, which could not have
emitted before the fix. That is a deploy check with no deploy API involved — the
fix leaves a trace only the deployed code can leave.

**The one that cannot be checked that way, and what to do instead.**
`2cddb0b10` gates a total ingestion outage. It is observable only by having the
failure it prevents, so waiting for evidence means waiting for the outage. A gate
you can only confirm by suffering what it stops is a gate you cannot verify —
check continuity of the thing it protects (`intelligence_claims` still arriving
daily) and record it as *merged, deploy not verified*, rather than pretending.

> **The reporting rule this produces:** after each merge, confirm the change is
> live before calling it delivered — or say explicitly *merged, not yet verified
> deployed*. Never let a SHA stand in for delivery.

## The inverse blind instrument — CI reporting red for a non-failure

The usual shape is an instrument reporting green over a real fault. This is the mirror image, and it
costs the same attention.

`cancel-in-progress: true` on the `...-pr` concurrency group means that when `main` advances under an
open PR, GitHub recomputes the merge ref, fires `synchronize`, and kills the in-flight run — so **CI
status reads FAILURE for a non-failure**. The job prints `5 successful, 8 total` and
`The operation was canceled`, which reads exactly like a mid-suite crash.

Four sessions have each debugged it as a real red. Observed on this estate: #1792's `node` job
cancelled at 4m21s; #1793 green at 9m22s in a quiet window; #1801 cancelled at 5m28s, then green at
9m3s on a plain re-run with no code change.

The cost is symmetric either way — a cancelled run needs a full re-run regardless — so on a repo with
this much concurrent merging the flag buys nothing and spends attention.

> **Re-run, do not debug.** A `node` job showing `N successful, M total` plus
> `The operation was canceled` is a cancellation, not a test failure. Confirm by re-running the job;
> investigate only if the second run fails too.

## A gate is only as wide as its file list — the nav sweep that could not see `features/`

2026-08-28. `tests/repo/system-nav-targets.test.ts` is a well-built control: positive control,
negative control, and a vacuity check that the page list is non-empty. It reported green while
`features/chat-v2/components/chat-capability-indicator.tsx:45` linked `href="/system/costs"` — a
segment with an `/api/system/costs` route but **no page**, so the chat capability badge opened a
404. The operator clicks it to check provider health.

The gate never saw it. `sourceFiles()` listed `app, lib, config, components` — `features/` and
`hooks/` are separate tracked source roots and were simply absent from the subject. Every
assertion was sound; the population was wrong.

**The generalisation, and it is not "add features to the list".** A control has *three* things
that can be wrong, and the canary pair only tests the first two: the rule, the verdict, and **the
subject**. A green sweep over the wrong file set is indistinguishable from a green sweep over the
right one — which is the [orphaned-subject shape](DEFECT-SHAPE-ORPHANED-SUBJECT.md) wearing a
different hat. So the fix ships with a **subject-coverage assertion**: the test now asserts the
file list actually contains entries under each of `app/`, `lib/`, `components/`, `features/`,
`hooks/`. A future narrowing fails loudly and names the directory it stopped seeing.

Probe for this shape elsewhere: for every gate that enumerates its own inputs — `git ls-files --
<dirs>`, a `readdirSync`, a glob — ask *what source root is not in that list*, then assert the
subject, not just the verdict.

Mutation receipt: restoring the dead href fails the widened sweep with
`chat-capability-indicator.tsx -> /system/costs`; the fixed tree passes 5/5.

## Resolved search — `(fastest * 2 + 5)`, carried as unfound across sessions

Recorded because the operator asked for the greps either way, and the answer is a scoping lesson
rather than a defect.

**Found:** `apps/worker/src/scheduler.ts:112`, inside `deriveStaleWindowMs()`.

**Verdict: correct by design, no action.** It derives the `/health` staleness window from the
actual cron schedules (`fastest` interval in minutes) instead of a hand-synced constant. Its own
header records why: the value *was* `5 * 60_000` against a "ticks every ~2 min" assumption, then
#1696 moved the render loop to a 15-minute cadence and nothing retuned it — so the floor exceeded
the threshold and `/health` reported stalled for ~10 of every 15 minutes. The `+ 5` is the margin;
the `* 2` is the multiplier. This expression is the *fix* for a rotted constant, not an instance
of one.

**Why earlier greps missed it:** they were scoped to `apps/statenour` and `apps/nickstire`. The
monorepo has **three** apps — `apps/worker/` is a real deploy target with its own scheduler, and a
two-app sweep silently excludes it. Same failure class as the section above: the rule was fine,
the subject was short one directory.

Greps that DID find it, from the repo root:

```bash
git grep -nE '\*\s*2\s*\+\s*5' -- '*.ts' '*.tsx' '*.mjs' '*.js'
git grep -niE 'fastest[^;]{0,40}(\*|times|x)\s*2' -- '*.ts' '*.tsx'
```

## A claim about the outside world has an expiry date — and an uncited one is expired by default

The blind instruments catalogued above all fail *inward*: a gate that cannot see its subject, a
number describing something other than what the reader assumes. This one fails *outward*, and it is
the general form of at least three instances already in this repo's history.

**The shape.** A statement about a library, API, platform, price or "best practice" is a measurement
of the world at the moment it was made. Unlike a repo fact, nobody here controls when it stops being
true, and nothing in the tree changes when it does. It therefore has an expiry date that is invisible
from the inside — *how you do it* and *how you did it last year* read identically in a model's
memory, in a PR body, and in a doc.

Three instances, each of which passed review at the time:

| The claim | What it actually was |
|---|---|
| ToolHive recommended for the tool layer | Benchmarked at ~15x the operator's scale; the premise did not apply here at all |
| The Higgsfield cost/capability figures | Never re-checked against the vendor after the first read; the official REST API existed for weeks while sessions concluded there was "no API path" |
| "3-5 posts a week doubles follower growth" | A study about **likes**, restated as **follower growth** — a real finding about a different variable |

Note the second one especially: the failure was symmetric. The stale claim said a capability was
*absent*, and that was just as wrong, and just as expensive, as claiming one that had gone away.
"Not in the repo" is a fact about the repo; "not available" is a claim about the world and needs a
source.

**The rule (charter rule 7).** Verify current practice *before* you change a library, API, SDK,
platform behaviour, pricing, config pattern or approach — not after, and not to confirm. Cite it:
URL and date, in the PR. The search outranks your prior, and a contradiction is a finding to report
rather than bury. Unverified means do not ship the change: an unverified switch is worse than leaving
working code alone.

**What is mechanically enforced, and what is not.** `scripts/agent-os/check-source-citation.mjs`
fires when a PR's diff **adds a dependency** (a `dependencies`/`devDependencies`/`peerDependencies`/
`optionalDependencies` entry, or a `pnpm-workspace.yaml` catalog move) and the body carries no URL
*and* date. It is wired as its own job in `agent-policy.yml` because the PR body is only reachable
from the event payload, not from the tree. `sourceCitation.test.mjs` canaries it in both directions,
including the two false positives that shaped it: a `"scripts"` entry is not a dependency (#1974),
and a reel-pack `brief.json` full of `"time": "0:00-0:04"` is not a manifest (#1972).

**Everything else in rule 7 is unenforceable and is deliberately not claimed.** Changing a platform
assumption, switching an approach on reasoning alone, or quoting a benchmark leaves no syntactic
trace in a diff. There is no cheap check for it, and inventing one would produce exactly the artifact
this document exists to catalogue — a control that reports green over a subject it cannot observe.
That half is on review, and on the coordination session's per-merge audit.

**Probe finding, recorded because it nearly hid the gate's own verdict.** During the adversarial pass
the gate printed `FAILED` and named three real packages while `$LASTEXITCODE` read `0`. The gate was
correct; `| Select-Object -First N` was masking the native exit code — the PowerShell twin of the
`pipe-to-tail` trap already recorded under Verify gates. Re-probed without a pipeline: 1 / 0 / 2 /0
for uncited-bump, docs-only, blind-invocation and cited-bump respectively. **Assert on the output as
well as the code**, which is what the "Writing one" step 3 below has said all along.

## A monitor's SCOPE is part of its correctness — the watcher that could not see its own hazard

2026-08-28, found by the watcher's author, against the author's own worktree. The coordination
session armed a watch over the shared checkout for five invariants, one of which was *"a tree is
checked out to `main`"* — the direct-commit hazard. It ran, it was green, and it was structurally
incapable of firing, because it inspected exactly one directory while the hazard can occur in any of
the **eight** worktrees attached to this repo.

The instance it missed was the author's own: **`gh pr merge --delete-branch` checks the local repo
out to the default branch after deleting the merged branch.** Merging a PR therefore parks whatever
worktree you ran it from on `main`, silently, as a side effect of a command whose stated purpose is
branch cleanup. The watch had flagged that exact hazard for other sessions two turns earlier and
could not see it happen to itself.

This is [the criterion](#the-criterion--every-canary-must-prove-it-can-see-the-failure) applied to a
monitor rather than a test, and it generalises past both: **the first question about any instrument
is whether its subject includes the thing it is watching for.** A test's subject is the code path it
drives; a monitor's subject is the set of places it looks. Narrowing either one turns a control into
a reassurance.

Fixed by sweeping `git worktree list` instead of one path — and, per this document's own rule, the
widened arm was positive-controlled before being trusted: the same loop was pointed at a branch a
worktree *was* on (`integration-audit`), and it found it. Only then does the `main` result read as a
real zero rather than a loop that iterates over nothing. Two lines of proof, and without them the
fix would have been exactly as unverified as the bug.

> **Standing consequence.** After any `gh pr merge --delete-branch`, check where you are standing.
> The merge succeeding and your checkout being where you left it are different facts.

## "Deployed" is not one fact in a monorepo

Same session, same day. Three merges landed in sequence and the session verified all three against
`bdnick.info/api/version`, the statenour deploy endpoint. One of those merges touched only
`scripts/agent-os/`, `.github/workflows/` and `docs/`.

That poll would have run its full fifteen minutes and reported `TIMEOUT`, and **a timeout is
indistinguishable from a stalled deploy** — the session would have escalated a healthy repo. The
merge was never going to appear there: Railway watch paths are per-app, so a diff touching no
`apps/**` path deploys nothing, and a CI-only change has no runtime surface to verify at all.

| what the merge touched | what deploys | how you verify it |
|---|---|---|
| `apps/statenour/**` | statenour | `bdnick.info/api/version` contains the SHA |
| `apps/nickstire/**` | nickstire | `nickstire.org/api/version` contains the SHA |
| neither (CI, docs, scripts) | **nothing** | the CI job itself ran — there is no deploy to wait for |

The rule: **choose the instrument from the diff's paths, not from habit.** Asking an app endpoint
about a change that app never received is the blind-instrument shape pointed outward — the
instrument is healthy, the subject is simply not in it, and the silence gets read as a fault.

**Correction, same session, one turn later — and it is the more instructive half.** The row above
originally read *"`nickstire.org/api/health` uptime resets"*, and the session stated in its report
that nickstire "only exposes `/api/health`, so the best I have is a restart proxy." **That was
false and was never probed.** nickstire serves `/api/version` with a `build.commit` field, exactly
as statenour does; one `curl` settled it. The weaker method was written into this document as
though it were a constraint.

A restart proxy and a commit check are not the same claim. *The container is new* does not entail
*the container carries your merge* — a rebuild triggered by anything else satisfies the proxy while
your change is still absent. So the documented method was not merely clumsier, it was **unable to
distinguish the success case from a specific failure case**, which is this document's whole subject.

The general form is already catalogued one section down under
[claims about the outside world](#a-claim-about-the-outside-world-has-an-expiry-date--and-an-uncited-one-is-expired-by-default),
and this instance shows it **fails symmetrically**: asserting a capability is ABSENT is as much an
uncited world-claim as asserting one exists, and costs the same. The Higgsfield REST API sat
unfound for weeks behind "there is no API path." This was the same error at one-turn scale, by the
author of that paragraph, which is roughly how durable the lesson is without a probe attached.

> **Before writing "X has no Y" into a doc or a report, spend the one command.** An absence claim
> needs evidence exactly as much as a presence claim.

### Three in one session, one shape: the instrument was narrower than its author assumed

Worth recording together, because the pattern is more useful than any of the three alone. In a
single coordination session the same author shipped three instruments and all three were wrong in
the same direction:

| instrument | what it assumed | what was true |
|---|---|---|
| the shared-tree watch | one directory is the repo | **eight worktrees**; it could not see the hazard it was written for, and missed an instance in its own author's tree |
| the deploy check | nickstire exposes only `/api/health` | `/api/version` with `build.commit` exists, unprobed |
| the merge audit | `gh pr list --state merged` returns newest-merged first | it sorts by **creation**; `.[0]` returned an older PR and the wrong diff got audited |

None was a hard failure. Each produced a plausible green, or a plausible answer about the wrong
subject — the reading a busy operator accepts. And each was settled by **one command**: sweep
`git worktree list`; `curl /api/version`; take the PR number from the squash commit subject
(`git log -1 --format=%s <sha>` yields `… (#NNNN)`), which is exact rather than inferred from a
sorted list.

The generalisation is not "be careful". It is that **an instrument's scope, its addressing, and its
ordering are all part of its correctness, and none of them is visible in a green result.** The
canary criterion at the top of this document asks whether a test can see its defect; these three ask
the same question of a monitor, of an endpoint choice, and of a query's sort order. Same criterion,
three surfaces nobody thinks to point it at.

### The sequel: each fix caused the next one, and only a cross-check ever caught them

The addressing error above did not end when it was fixed. It became three, in a row, in one session,
each defect introduced by the repair of its predecessor. Recorded in full because the shape —
*a fix for one addressing bug is not immunity from addressing bugs* — is the same warning
`guard-red-team` gives about deny-lists, arriving here in a place nobody expected it.

| # | the method | why it broke |
|---|---|---|
| 1 | `gh pr list --state merged`, take `.[0]` | sorts by **creation**, not merge time — returned an older PR |
| 2 | first `#N` in the squash subject | a PR **title** can itself contain a PR reference: `… (#1991) (#1993)` resolved to #1991, the wrong one |
| 3 | **last** `#N` in the squash subject | PowerShell collapses a single-match result to a **string**, so `[-1]` returned the last *character* — `#1994` became `#4` |

Fix 3 is the sharpest: it worked on the rare two-reference case it was built for and broke the
common single-reference case, which is every ordinary PR. The correct form needs both halves —
take the LAST match **and** force an array so one match cannot degrade to a string:

```powershell
$all = @([regex]::Matches($subject, '#(\d+)') | ForEach-Object { $_.Groups[1].Value })
$prNumber = $all[-1]
```

**What actually caught #2 and #3 was not vigilance — it was a cross-check between two independent
views of the same fact.** Comparing the PR's own file list against `git show --name-only` on the
merge commit: 6-vs-1 exposed the second, 17-vs-4 exposed the third. Neither error announced itself.
Both returned a confident, well-formed audit *of the wrong pull request*, which is the failure mode
this whole document exists for — a plausible answer about a subject you did not intend to measure.

> **The durable rule, cheaper than getting the addressing right:** never audit an artifact by one
> path to it. Resolve it two ways and compare. The comparison costs one command and fails loudly;
> the addressing fails silently, and it failed silently three times to the session whose job that
> week was auditing everyone else.

## Writing one

Copy the shape from any of the three proven controls:

1. **Copy the real inputs** to a throwaway location — never mutate the repo's own files.
2. **Break exactly one thing.** One canary, one defect; a canary that breaks two things cannot tell you
   which assertion caught it.
3. **Assert the message, not just the exit code** — otherwise an unrelated failure masquerades as your
   canary passing. (This bit two of the adapter canaries on first run: the denial prints the
   regex *source*, not the human phrasing.)
4. **Add the positive control.** Assert an unbroken copy still passes.
5. If the control is not reachable from a test, **make it reachable** — `check-adapters.mjs` needed an
   `AGENT_OS_ROOT` override before it could be pointed at a fixture at all. That change is part of the
   canary, not a prerequisite for it.

## Regenerating

```bash
node scripts/agent-os/check-adapters.mjs            # prints its own check count
node --test scripts/agent-os/adapters.test.mjs      # the adapter canaries
pnpm agent:verify                                   # both canary suites + parity
```

Per-chain link counts come from `apps/<app>/package.json` (`verify:hard`, `verify`) and `lefthook.yml`.

---

## Shape index

Each file below is a defect SHAPE — a recurring way a control looks correct and is not — plus
the probe for finding the next instance. A shape earns a file when it has been seen twice.

- [`DEFECT-SHAPE-ORPHANED-SUBJECT.md`](DEFECT-SHAPE-ORPHANED-SUBJECT.md) — the gate runs, passes,
  and never looks at the thing it was written to protect.
- [`DEFECT-SHAPE-SILENT-INSTRUMENT.md`](DEFECT-SHAPE-SILENT-INSTRUMENT.md) — the measurement
  returns a clean zero because it cannot see the target at all.
- [`DEFECT-SHAPE-DISCARDED-ANSWER.md`](DEFECT-SHAPE-DISCARDED-ANSWER.md) — **added 2026-08-29
  (PR #2019).** The system computed or possessed the right answer and threw it away, then emitted
  a CONFIDENT wrong output rather than an error. Three instances in one chat-recall path: a tool
  advertised as FTS that ran a substring match; a search that computed `ts_rank` relevance and
  re-sorted by `confidence`, burying the operator's own pinned memory under 7,059 bulk chunks at
  the ceiling confidence; and a prompt with no rule for narrating an empty result, so the model
  turned one miss into "I don't have reliable information about whether that memory exists".
  A fourth, found while fixing those: `count` reported the page size, not the match total —
  112 matches displayed as `16`. Nothing crashes, nothing logs, nothing goes red.
  **Probe: what did this compute that it does not return?**
