# StateNour Deep Audit - FINAL

**Provenance (§11), threat model (§30), synthesis (§54), and the verification pass.**

Third and final increment. Continues `...-PASS0-2.md` and `...-PASS3-4.md`.

Evidence classes: **A** verified code · **C** verified runtime · **H** hypothesis
(explicitly untested) · **I** unknown/not verified.

---

## 13. SNAPSHOT DRIFT - READ THIS FIRST

**Production moved during the audit.**

| | SHA | Time |
|---|---|---|
| Audited snapshot | `0e6d2301cd19aaef34e22dc6f24a529eb1333bf3` | 14:07 EDT |
| **Production now** | **`04c55da878f0d1ff0de5867f140a686e4fb40444`** | deployed 16:17 EDT |

`origin/main` advanced to `04c55da` at ~16:17 EDT (`/api/version`, Class C).
I did not fetch it - a fetch writes to `.git`, the disk was at 0 bytes, and I am
read-only.

**What this means for the findings:**

- **W-4 (auth bypass) is re-verified live on `04c55da`** - `/decisions/1.2` and
  `/decisions/9.9` both return **HTTP 200** unauthenticated; `/decisions/1`
  correctly 307s. The bypass survived the new deploy. (Class C, re-probed 16:52 EDT)
- **Every other code-level finding is pinned to `0e6d230`** and should be
  re-checked against `04c55da` before acting. I am not going to assert they
  still hold on a commit I have not read.

This is the exact failure the program's §2 warns about, and it happened inside a
55-minute audit window. It is also the strongest possible argument for turning
these findings into **tests** rather than a document: a test re-runs itself
against whatever HEAD is current; this file does not.

---

## 14. §11 - PROVENANCE ARCHITECTURE

### 14.1 What exists and works (Class A)

- **`source` is recorded on every memory write.** `BrainMemory.source` carries
  values like `gmail_cron`, `cron:ingest-gmail`, `device_analysis`,
  `behavior_tracking`, `vision`, `manual`. Origin is attributable.
- **Reverse provenance is a real feature.** `readMessageProvenance()` answers
  "which memories most likely shaped this message?", exposed at
  `/api/brain/provenance/[messageId]` (owner-gated) and
  `trpc.chat.messageProvenance` - one shared service, so the two cannot drift.
  Three test files cover it, including `provenance-label.test.ts` and
  `brain-provenance-receipts.test.ts`.
- **`AuditEvent`** is written by ingestion (`actor: "gmail_ingest_cron"`,
  `eventType: "gmail_messages_ingested"`).
- **The action-language contract** is a genuinely unusual honesty control
  (`finalize-system-prompt.ts:395`): when actions can run, the prompt forbids
  completion tense - *"Sending...", never "Sent"* - because action blocks execute
  after the response streams, so a completion claim is unverifiable at write time.
  A separate receipt-confirmed message reports the real outcome. There is also an
  `action-claim-detector.ts` that regex-matches Nick claiming "email sent" and
  maps it back to the tool that would have had to fire.

That last item is the single most impressive thing I found in this codebase. It
is a structural defense against the model asserting a side effect it did not
perform - the precise failure the program's §0 forbids.

### 14.2 FINDING P-1 (MEDIUM-HIGH) - the memory-quarantine control has no producer

This is the strongest instance of your recurring failure mode in the audit, and
it is a **"reader with no writer"** - the mirror image of W-1.

**The control (Class A).** `tool-policy.ts:124-133`:

```ts
// 6. Memory write from external content -> require memory review
const isMemoryWrite = request.memoryWriteRequested || cap.memoryWriteAllowed;
if (isMemoryWrite && request.containsExternalContent) {
  return { decision: "require_memory_review",
           reason: "Memory writes from external untrusted content require human memory review.",
           requiredApproval: "memory_review_required" };
}
```

When it fires, `guardian.ts:463` creates a `MemoryInboxItem` (quarantine),
throws `GuardianApprovalPendingError`, and `/system/inbox` renders a human
review queue backed by `trpc.system.inbox`. There is a passing test
(`safety-pipelines.test.ts:80`) proving the quarantine path end to end.

**The gap.** Every occurrence of `containsExternalContent` in the repository:

```
lib/tools/tool-policy.ts:27          the interface field
lib/tools/tool-policy.ts:126         the reader
lib/ai/runtime/approval-gate.ts:33   passes it through from payload
lib/tools/guardian.ts:407            passes it through from payload
lib/trpc/routers/system/tools.ts:19  zod schema, read-only preview endpoint
tests/tools/safety-pipelines.test.ts:96   <- sets true
tests/tools/tool-policy.test.ts:202       <- sets true
```

**No production code path ever sets it to `true`.** The only writers are two
tests. `prisma.memoryInboxItem.create` appears in exactly one production
location - `guardian.ts:463` - inside the branch this flag guards.

**And ingestion bypasses the policy layer entirely.** `ingest-gmail` calls
`brainMemory.remember(category, gmail_${m.id}, content, "gmail_cron", {...})`
(`route.ts:275`) - a direct memory-manager write. `evaluateToolAction` is never
consulted, so even a correctly-set flag would not be read on this path. The same
shape applies to `ingest-drive`, `ingest-calendar`, and `ingest-reviews`.

**Net:** the memory-poisoning defense, its quarantine table, and its human
review UI are all built, tested, and unreachable from production. The test
passes because it calls the guarded function directly - the same shape as the
a11y test in W-3.

### 14.3 Confidence is a bare float with no stated calibration (Class A, LOW)

`BrainMemory.confidence Float @default(0.5)`. Program §13 is explicit: no
arbitrary numeric confidence unless it is calibrated with a defined
probabilistic meaning; prefer qualitative classes otherwise. I found no
calibration definition for this field. What "0.5" means, and whether a 0.7
memory is meaningfully more reliable than a 0.6, is **Class I - not established.**
Given the repo already runs `calibration-enforcer.ts` and a calibration cron,
this may be handled somewhere I did not reach.

---

## 15. §30 - SECURITY / PRIVACY THREAT MODEL (partial)

### 15.1 Findings carried forward

| ID | Severity | Finding |
|---|---|---|
| **W-4** | **P0** | Live unauthenticated session-gate bypass via the middleware dot-rule. **Re-verified on current prod `04c55da`.** |
| **W-5** | HIGH | The route-policy canary tests `isPublic()` and never imports `middleware.ts` - structurally blind to W-4 |
| **P-1** | MED-HIGH | Memory-quarantine control has no production producer (§14.2) |
| **N-1** | MEDIUM | `NICK_MUTATION_LOCK` fails OPEN on flag-resolution error, in both enforcement points |
| **N-2** | LOW/latent | `browser.extract` / `browser.observe` are high-risk with `approvalPolicy: "none"`; currently `status: inert` |

### 15.2 Prompt injection - a control that was already caught and fixed (Class A)

`scripts/scan-prompt-injection.ts` runs inside `verify:hard` with five rules
(PI-001 template-string user content in `aiChat()`; PI-002 missing
`requireSession` under `/api/nick/*`; PI-003 missing budget check; PI-004
`dangerouslySetInnerHTML`; PI-005 logging `req.body`). These are **first-party
code-hygiene** rules - they do not address indirect injection.

Indirect injection is handled separately, and the history is instructive.
`finalize-system-prompt.ts:400-410` documents, in the team's own words:

> `fenceContent()` has wrapped untrusted tool output in `<tool_data source="...">`
> fences across 7 production modules since it shipped - but the addendum that
> TEACHES the model those fences are inert data had **zero production importers**.
> Definition plus its own test, nothing else. [...] the detection half of the
> injection control shipped, the instruction half did not.

It was fixed, and fixed well: `TOOL_DATA_FENCING_RULE` is appended **after**
`trimPromptToBudget`, deliberately, so a long conversation cannot silently trim
the defense away - *"a defense that silently disappears on long conversations is
worse than none."* That is exactly the right instinct.

**Coverage today (Class A).** `fenceContent` is applied at ~20 call sites:
web search (`searchWebVerified`, `arsenalWebSearch`, `arsenalResearch`,
`arsenalDeepResearch`), Gmail reads (`arsenalGmailInbox`,
`arsenalGmailReadThread`), documents (`searchDocuments`), transcripts
(`fetchVideoTranscript`), `browseAndDo`, deep research page reads, `last30days`
stdout/stderr, and cross-session summaries (`findRelatedConversations`).

### 15.3 FINDING S-1 (MEDIUM-HIGH) - recalled memory is not fenced

The fencing covers **tool results at read time**. It does not cover **BrainMemory
recall injected into the system prompt** (`finalize-system-prompt.ts:272`,
`contextBlocksFired.recall`). The only brain-side fence is
`findRelatedConversations` with `source="cross_session"`.

That is the one path external content reaches by a different door:

1. An email arrives containing crafted instructions.
2. `ingest-gmail` writes its content into `BrainMemory` via
   `brainMemory.remember(..., "gmail_cron", ...)` - no policy layer, no
   quarantine (§14.2).
3. A later chat turn's recall pulls that memory into system-prompt context -
   **unfenced**, and the `TOOL_DATA_FENCING_RULE` speaks specifically about
   `<tool_data>` fences, which recall content does not carry.

Steps 1-3 are **Class A** as a code path. **I did not execute this attack -
the end-to-end exploitability is Class H (hypothesis).** Confirming it needs an
authenticated session and a controlled test email, both outside read-only scope.

**Why this is MEDIUM-HIGH and not critical - the mitigation is real.** Every
tool with `externalMutation: true` is `owner_required` or `screenshot_required`
(PASS 3, §8.2). A successful injection can steer Nick's reasoning, corrupt what
he "believes", and shape what he tells you - but it **cannot send an email, an
SMS, or open a PR without you approving it.** The permission architecture
contains the blast radius. That is the system working as designed, and it is why
the tool boundary being strong matters so much.

### 15.4 NOT INVESTIGATED in §30

Stated rather than filled with plausible paragraphs:

| Area | Status |
|---|---|
| Webhook signature verification (`stripe`, `make`, `nickstire`, `inbound-crm`) | **NOT INVESTIGATED.** Telegram's own `TELEGRAM_WEBHOOK_SECRET` + owner-id + chat-id checks were observed at `telegram/webhook/route.ts:97-162`; the other four were not read. |
| SSRF via URL-fetching tools | NOT INVESTIGATED |
| File upload / attachment handling | NOT INVESTIGATED |
| Token storage, rotation, revocation; OAuth scope minimization | NOT INVESTIGATED |
| CSRF | NOT INVESTIGATED (CSP verified; CSRF is a separate control) |
| Rate limiting | NOT INVESTIGATED (`/api/system/rate-limits` exists) |
| Audit-log integrity (append-only? tamper-evident?) | NOT INVESTIGATED |
| Backups, export/delete, data retention | NOT INVESTIGATED |
| Supply chain | Partially gated by `check:audit-deps` in `verify:hard`; not independently assessed |

---

## 16. §4 - DOMAIN MODEL (observations only, not a verdict)

I did not run the ontology pass. Three observations fell out of other work and
are worth recording; none is a recommendation.

1. **`WorkItem` vs `Task` must stay separate.** Agent memory records a prior
   finding that `WorkItem` is a queue and must never be merged into `Task`. I did
   not re-derive it; flagging so a future pass does not "simplify" it.
2. **The Missions vocabulary just changed under active development.** #2052
   replaced XP/level/streak components (`level-up-modal`, `xp-particle`,
   `missions-health-strip`, `top-mission-today`) with deck primitives
   (`deck-evidence`, `deck-next-move`, `deck-readiness-line`, `deck-rhythms`,
   `deck-waiting`) plus `scorer v2`. §20's question - "are Missions actually
   missions, or domains/goals/projects?" - is being answered in code right now by
   another session. **Auditing it from a snapshot would produce stale advice.**
3. **Gamification is already being removed**, which pre-empts much of §24. The
   XP/level/particle components were deleted in the deployed commit. Judging a
   gamification system that was removed today would be auditing a ghost.

---

## 17. §54 - SYNTHESIS

### 17.1 The one-paragraph diagnosis

StateNour is **not** an under-engineered product with sloppy controls. It is a
product with an unusually sophisticated safety architecture - capability
registry, policy engine, approval gate, mutation kill switch, tool-output
fencing, an anti-false-completion prompt contract, a bidirectional cron manifest
verifier, and drift canaries that scan source for call sites - applied
**unevenly**. Where the discipline was applied, it holds up under adversarial
reading. Where it was not, the same defect shape recurs: **a control is built,
looks correct, is even tested, and one half of its wiring is missing.** The
severity of any given instance is determined by which side of the product it
lands on, and the worst instance landed on the public HTTP boundary.

### 17.2 The recurring defect shape, stated precisely

Every significant finding in this audit is one of three variants of the same thing:

| Variant | Instances |
|---|---|
| **Writer with no reader** - something produces state nothing consumes | W-1 (`GlobalTopTicker` mounted nowhere while a comment says alerts flow through it) |
| **Reader with no writer** - a control waits for a signal nothing emits | **P-1** (`containsExternalContent` never set), and the fixed 2026-08-03 fencing bug |
| **Gate with the wrong subject** - a test asserts a helper's verdict, not the boundary's behavior | **W-5** (canary imports `isPublic`, not `middleware`), **W-3** (a11y test reads component source text) |

Agent memory already records this: *"4 dead controls, all WRITER-WITH-NO-READER -
grep the CONSUMER and assert IT."* This audit adds the two mirror variants. The
generalizable rule is stronger than any individual fix:

> **A control is not shipped until a test asserts the OBSERVABLE BEHAVIOUR at the
> boundary, exercised through the path production actually takes.** Not that the
> component exists. Not that the helper returns the right value. Not that the
> file contains the right string.

### 17.3 BUILD NOW (highest evidence x consequence)

1. **Fix `middleware.ts:55`** - live P0, re-verified on current prod. The correct
   end-anchored pattern already exists in `config.matcher` immediately below.
2. **Add the middleware behaviour test** - assert `/decisions/1.2` is DENIED.
   Break it first and watch it fail, per repo doctrine.
3. **Wire P-1 or delete it** - either set `containsExternalContent: true` on the
   ingestion paths (and route them through the policy layer), or remove the
   quarantine branch, `MemoryInboxItem`, and `/system/inbox`. A dormant safety
   control is worse than none: it reads as protection on the org chart.
4. **Fence recall content** (S-1), or extend `TOOL_DATA_FENCING_RULE` to name
   memory-recall blocks explicitly.
5. **Add the third kill-switch test: flag resolution throws** (N-1), then make
   both enforcement points fail in the direction you actually want.
6. **Resolve W-1** - mount `GlobalTopTicker` or delete it and fix the false comment.
7. **Decide `/business`** - delete or move; de-linked-but-deployed is the worst state.

### 17.4 The highest-leverage structural change

**Port `guardian-registry-drift.test.ts` to the other two boundaries.**

That test is the best control in the repository: it walks the source tree,
enumerates every `withGuardian("<id>", ...)` call site, asserts each is either a
registered capability or explicitly `reliabilityOnly`, **and adds an inverse
check** that a `reliabilityOnly` id can never be a gated or mutating tool. It
asserts the subject, not the verdict. It exists because unregistered ids once
silently denied chat web search.

Two boundaries need the identical treatment:

- **Auth**: enumerate page routes, assert each is denied without a session -
  catches W-4 and every future variant.
- **UI mount graph**: enumerate `components/**`, assert each is transitively
  reachable from an entrypoint with an explicit parked-file allowlist - catches
  W-1, W-2, W-3 and the 17 orphans in one gate.

`verify-crons.ts` already proves the pattern works for a 55-route surface. The
capability is in the building.

### 17.5 VALIDATE / DEFER / NEVER

- **VALIDATE**: whether the 152-tool gap between the 29-entry capability registry
  and ~181 registered tools is deliberate scoping or drift. Whether S-1 is
  exploitable end to end. Whether `BrainMemory.confidence` is calibrated.
- **DEFER**: the ontology pass, until the Missions/Home/Settings rewrites land -
  auditing a surface mid-reconstruction produces stale advice.
- **NEVER (on this evidence)**: do not introduce a policy engine (Cedar/OPA/
  Casbin). The existing capability registry plus `evaluateToolAction` already
  gives typed risk classes, approval policies, audit requirements, and a drift
  canary. A policy engine would add a dependency, a DSL, and infrastructure while
  removing none of the existing complexity - it fails the program's NET
  COMPLEXITY RULE outright. Do not add a durable-execution framework
  (Temporal/Inngest-replacement) either; `ApprovalRequest` with a monotonic
  status state machine and an atomic compare-and-swap claim already implements
  durable approval correctly.

### 17.6 One-paragraph product thesis

StateNour should be the operator's **evidence-and-judgment layer**: it observes
what happened, records where each belief came from, distinguishes what Nour
authored from what Nick inferred, surfaces only what genuinely needs his
judgment, executes reversibly and asks before anything consequential, and stays
quiet otherwise. It is closer to that than the route count suggests - the
provenance service, the action-language contract, and the owner-gated capability
model are all that thesis expressed in code. What it does not yet have is the
guarantee that its controls are *connected*, and that guarantee is a test-shaped
problem, not an architecture-shaped one.

---

## 18. VERIFICATION PASS - I re-checked my own headline claims

Every claim below was re-derived independently after the initial finding.

| Claim | Re-verification | Result |
|---|---|---|
| W-4 bypass live | Re-probed prod after it redeployed to `04c55da`: `/decisions/1.2` -> 200, `/decisions/9.9` -> 200, `/decisions/1` -> 307 | **HOLDS**, on current prod |
| W-1 `GlobalTopTicker` dead | Re-grepped symbol across `app/`+`components/`+`features/` | **HOLDS** - 2 occurrences: its declaration + one comment |
| 17 unreachable components | Re-ran BFS with a corrected entrypoint set (added app-root `not-found`/`manifest`/`robots` conventions) | **HOLDS** - 17 (6.2%); `page-header.tsx` correctly dropped out |
| W-5 canary blind | Re-read the test's complete import list | **HOLDS** - imports only `isPublic, PUBLIC_EXACT` |
| P-1 no producer | Re-grepped `containsExternalContent` across `lib/` + `app/`, excluded tests | **HOLDS** - zero production writers |
| Permission matrix | Re-extracted with an indentation-aware parser after two bad parsers; cross-checked `gmail.sendDraft` against the raw file | **HOLDS** - 7 external-mutation tools, 0 ungated |

### 18.1 Errors I made and corrected (4 total)

| # | Wrong output | Cause | Caught by |
|---|---|---|---|
| 1 | "27.7% of components orphaned" | `os.path.normpath` yields backslashes on Windows; all relative-import edges failed | Spot-checking 6 claimed orphans |
| 2 | "`gmail.sendDraft` is medium-risk, ungated" (a false P0) | Flat parser matched fields at any indentation; nested blocks bled across entries | Reading the raw registry entry |
| 3 | "`evaluateToolPolicy` has zero callers" (a false "unenforced permission system") | Grepped a symbol that does not exist; the export is `evaluateToolAction` | Listing the module's real exports |
| 4 | `page-header.tsx` listed as orphaned | Entrypoint regex required an intermediate directory, missing app-root `not-found.tsx` | Per-file verification of all 18 |

Three of these four would have been dramatic headline findings. **The correction
rate on my own mechanical detectors was roughly one in three.** That is the
single most transferable result of this audit: it is the same rate at which the
codebase's own instruments were found to be mis-wired, and it argues that no
automated finding here - mine or a future session's - should be reported without
a positive control or a manual spot-check first.

---

## 19. COMPLETE LIST OF WHAT WAS NOT DONE

So the next session knows exactly where the edge is.

**Not investigated at all:** database schema/indexes/N+1/query plans · migrations
· background job retry/idempotency/cancellation semantics · PWA + service worker
+ offline · performance/bundles/Core Web Vitals · accessibility beyond the
a11y test's own shape · brain retrieval quality (recall/precision benchmarking)
· caching and state management · cross-device consistency · §5 external frontier
(competitors, OSS, standards) · §35 competitive pattern research · §37 product
metrics · §38 AI evals architecture · §19-22 wireframes and interaction flows ·
§43-46 dependency budget, standards matrix, trust-boundary diagram.

**Partially done:** §6 boundary (inventory built, verdicts pending) · §30 threat
model (see §15.4) · §4 ontology (three observations, no model).

**Structurally impossible read-only:** all runtime verification of authenticated
controls. Every wiring finding here is code-plus-unauthenticated-HTTP. The
handler -> API -> authz -> DB -> UI round trip was never executed for any control.
That is the largest single gap in this audit, and closing it needs an
authenticated session and write permission.

**Deliberately deferred:** Home, Missions, Settings deep-dives - all three are
under active reconstruction by sibling sessions, and #2052/#2053 merged and
deployed mid-audit.

---

*Findings pinned to `0e6d2301c` unless marked otherwise. W-4 re-verified on
`04c55da`, which is production as of 16:52 EDT 2026-09-01.*
