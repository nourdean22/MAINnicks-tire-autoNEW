# StateNour - What To Do Monday (synthesis of the 2026-09-01 brief + audit)

> **Status as of 2026-09-02 (added after the wave shipped - the body below is the plan as written on 2026-09-01):**
> R1 closed by #2058 `1bc3d43b0` (BOTH halves - the review found a second one: the matcher skipped
> middleware for `/decisions/1.png`), re-probed live on production: every bypass shape 307.
> R2 closed in the same PR. R3 (P-1 + S-1), R4 (W-1, W-3) and R5's UI half shipped in #2059
> `b7d0f62f3`; R5's auth half is in #2058. R6 shipped fail-CLOSED in #2060 on operator instruction.
> Still open: R7 `/business`, R8 tracing env (`LANGFUSE_PUBLIC_KEY`+`LANGFUSE_SECRET_KEY`,
> `SENTRY_DSN`/`NEXT_PUBLIC_SENTRY_DSN` unset), R9 the AI SDK major, the 13 parked components,
> drive/calendar/reviews intake, and the S-1 end-to-end attack (still a hypothesis - never run).
> Ship history: `apps/statenour/docs/RECONCILIATION.md` top entry.

**Read this instead of the other two when deciding what to do.** It ranks actions; the sources
carry the evidence. It is a decision document, so it says where the two sources disagree and
which one it follows.

| Source | Produced by | Pinned to | Standing |
|---|---|---|---|
| `apps/statenour/docs/research/2026-09-01-master-research-brief.md` (A-E) | "Rewrite master research prompt" session | local `6e1114e2b`, **4 behind origin** at measurement | Its C.3 numbers carry their own staleness warning. This plan inherits the warning, not the numbers. |
| `docs/research/2026-09-01-statenour-audit-{PASS0-2,PASS3-4,FINAL}.md` | "StateNour full product audit" session, read-only | `origin/main @ 0e6d2301c` = production at 14:07 EDT; W-4 re-probed on `04c55da` | Code findings pinned to `0e6d230`; production has moved twice since. |
| **This plan** | this session | **`origin/main @ 5c1195e6f` (#2055) = production at 22:49Z**, re-probed live | Anything not re-checked here is stated as inherited. |

Evidence classes, unchanged from the audit: **A** verified code - **C** verified runtime -
**H** hypothesis, untested - **I** unknown. Plus one this plan adds: **M** = produced by a
mechanical detector the audit itself later found wrong at roughly one in three (FINAL 18.1) and
not independently re-verified. No numeric confidence anywhere; both sources ban it and so does
this.

---

## 1. Where the sources disagree, and what this plan follows

The two sessions could not see each other. These are the seams; none is papered over.

| # | Seam | Brief says | Audit says | This plan follows |
|---|---|---|---|---|
| 1 | **Ground truth was measured on a stale checkout** | C.3 measured at `6e1114e2b`; a staleness warning was added after reading the audit's headings (E.3). | PASS0-2 1.3: local HEAD 3 commits behind production; audited `origin/main` from the object store instead. | **Audit.** Every repo number here comes from the audit's pinned SHA or from this session's re-probe of `5c1195e`. The brief's numbers are used only where they are about the brief's own subject (the prompt). |
| 2 | **Will a 54-section program thin out into filler?** | E.3 predicts compression lands invisibly on runtime truth, control wiring and verification. | PASS0-2 delivered 26 headings, stopped at PASS 2 of 10, and wrote "What I did not investigate" explicitly. | **Neither - it is untested, not falsified.** The brief itself says so (E.3, three conclusions): the prediction is about the *finished* 56-item report, which never existed. The evidence so far runs against the prediction and is a single confounded observation. Recorded as open; the test is stated in E.3. |
| 3 | **`/business`** | Verified: it carries shop revenue AND the operator's own coaching CRM; tire-shop relocation rules do not automatically apply (A.7, E.2 item 6). | B-1: DELETE or MOVE to Nick's Tire Admin; de-linked is the worst state (PASS3-4 9.2). | **Both, in sequence.** The audit is right that de-linked-but-deployed-and-AI-routable is the worst state. The brief is right that "move to the shop" would relocate a personal practice. So: an operator decision with the coaching-CRM split named, not an engineering default. Ranked as R7. |
| 4 | **Surface counts** | 37 `page.tsx`, 35 real surfaces, 2 redirect stubs; 255 components at `6e1114e2b`. | 37 page routes; 274 components at `0e6d230` (includes `features/`). | **Not a disagreement** - different SHAs and different globs. Cited from the audit. The brief's stub finding (`/scoreboard`, `/goals` redirect; never delete them) is independently true and carried into section 4. |
| 5 | **Mechanical detectors** | A.2: form checks are not truth checks; demands positive controls. | FINAL 18.1: four of its own headline detectors were wrong before correction. | **Agree.** Every finding below carries A/C/H/I, and **M** where it rests on an uncorroborated detector. W-4, W-5, W-1 and P-1 were each re-verified by a second method (FINAL 18); W-4 is re-verified a third time here. |
| 6 | **`verify:hard` is red** | C.3: red for pre-existing reasons; do not claim it as new. | Not re-run (read-only). | **Agree**; agent memory records the same (policy-coverage / operator seeds). Any phase-2 run must separate pre-existing red from new red. |

---

## 2. Ranked actions

Order is lexicographic on (evidence strength, consequence, cost), per the brief's own rule -
nothing is multiplied. Each item: what - evidence - cost - unblocks - what changes the call.

### R1 - P0: the session gate lets any dotted non-API path through. NOT FIXED BY THIS PR.

**What.** `middleware.ts:55` - `if (pathname.includes(".") && !pathname.startsWith("/api/")) return allow();` - intends to pass static assets and instead passes every page path containing a dot, before `req.auth` is consulted. The only dynamic page route today is `/decisions/[id]`.

**Evidence: C, three times.** Audit on `0e6d230` and `04c55da`; **this session on `5c1195e` at 22:49Z: `/decisions/1` -> 307 to sign-in; `/decisions/1.2`, `/decisions/9.9`, `/decisions/abc.def` -> 200.** Reproduce: `curl -o /dev/null -w '%{http_code}' https://bdnick.info/decisions/1.2`.

**Blast radius today (A + C, audit 3.6):** the authenticated app shell and client bundle, not decision data - the page's query is disabled for non-integer ids and `/api/trpc` is not public. The containment is coincidental: the next page route with a dotted segment (slug, filename, email, version) is an anonymous data path with no failing test.

**Cost:** one line - the end-anchored asset-extension pattern already exists in `config.matcher` directly below - plus a test that exercises the middleware's allow/deny decision on `/decisions/1.2`, not `isPublic()`. Break it first.

**Unblocks:** R2 (the canary has a subject to guard), and every future dynamic route.

**What changes the call:** nothing short of the probe returning 307. **This document's merge is not that fix.** The code change ships as its own PR so it is reviewable and revertable alone.

### R2 - W-5: point the security canary at the boundary, not the helper

**What.** `tests/security/route-policy.test.ts` imports only `isPublic, PUBLIC_EXACT`; it never imports `middleware.ts`, so it is structurally blind to R1 - a gate with the wrong subject (repo rule: assert the SUBJECT, not the verdict).

**Evidence: A** (complete import list read twice). **Cost:** small; ships with R1. **Unblocks:** R5's auth half. **Changes the call:** a second test file that already imports middleware and asserts a denied dotted path - none was found.

### R3 - P-1 + S-1: the memory quarantine has no producer, and recall is unfenced

**P-1, what.** `tool-policy.ts:126` quarantines memory writes when `containsExternalContent` is true (`MemoryInboxItem` + `/system/inbox` review queue + a passing test). The flag is set true in exactly two places, both tests. Zero production writers. Meanwhile `ingest-gmail` writes email content straight into `BrainMemory` via `brainMemory.remember(..., "gmail_cron", ...)` (`route.ts:275`), never consulting the policy layer; `ingest-drive`, `ingest-calendar`, `ingest-reviews` share the shape. A reader with no writer.

**S-1, what.** `fenceContent()` wraps ~20 tool-result sites; recalled `BrainMemory` injected at `finalize-system-prompt.ts:272` is not fenced, and `TOOL_DATA_FENCING_RULE` speaks only about `<tool_data>` fences. Gmail content therefore reaches the prompt by a door the fencing does not cover.

**Evidence:** the code path is **A** (both re-grepped in FINAL 18). **The end-to-end attack - crafted email -> ingest -> recall -> steered reasoning - is H. The audit did not execute it** and neither did this session; it needs an authenticated session and a controlled email. Blast radius is bounded by a real control: every `externalMutation: true` tool is `owner_required` or `screenshot_required` (PASS3-4 8.2, **A**), so a successful injection steers what Nick believes and says, not what he sends.

**Cost:** medium. Route ingestion through the policy layer so the quarantine receives traffic, and prove it with a test that fires from a production code path rather than a test-only flag; then fence recall, appending the rule **after** `trimPromptToBudget` - the team already learned that a defense trimmed away on long conversations is worse than none (FINAL 15.2). The alternative the audit offers - delete the quarantine, its table and its UI - is legitimate; a dormant control reads as protection on the org chart.

**Unblocks:** honest answers to "why does Nick believe this?" for external-origin memories.

**What changes the call:** a production writer of `containsExternalContent` that the grep missed (none found in `lib/` + `app/`); or a recall-side fence found under a different name.

### R4 - Wiring defects: W-1, W-3, and the W-2 islands

- **W-1 (A, re-grepped):** `GlobalTopTicker` has zero importers while `app/(mastery)/layout.tsx:73-77` says priority alerts flow through it. **Mount it or delete it and fix the comment - the current state, a documented channel that does not exist, is the worst of three.** Not established (**I**): whether priority alerts reach the operator by another channel (`AppBadge`, push, Telegram). Do not read W-1 as "you receive no alerts."
- **W-3 (A):** `tests/components/mobile-a11y.test.tsx` asserts `readFileSync(...).toContain(...)` on component source. It cannot distinguish a styled live component from a styled dead one, and six of the seven dead Ultron components have this as their only "coverage". Replace source-text assertions with something that fails when nothing mounts the subject.
- **W-2 (A for the graph, M for "delete"):** 17 unreachable components in four clusters (3D scene, actions/loops, Ultron HUD, `operator/compound-chain` whose backend is fully alive). Triage into delete / re-mount / parked; drop the dead `scene-canvas` reference from `next.config.ts:90`. The 17 came from a detector that was wrong once (27.7% -> 6.6%) and was then spot-checked per file; treat individual entries as **M** until opened.

**Cost:** small each. **Unblocks:** R5's UI half has a clean baseline. **Changes the call:** a string-keyed or dynamic registry that mounts any of these - the audit looked and found none.

### R5 - The structural fix: port `guardian-registry-drift.test.ts` to the auth boundary and the UI mount graph

**What.** That test walks the source tree, enumerates every `withGuardian("<id>", ...)` call site, asserts each is a registered capability or explicitly `reliabilityOnly`, **and adds the inverse check**. It asserts the subject. `scripts/verify-crons.ts` does the same bidirectionally for 55 cron routes. Neither the auth boundary nor the UI tree has this, which is why R1 and R4 exist.

- **Auth:** enumerate page routes from the filesystem, assert each is denied without a session through the middleware's real decision, with the public allowlist as the only exception.
- **UI:** enumerate `components/**`, assert transitive reachability from an entrypoint, with an explicit parked-file allowlist.

**Evidence: A** that the pattern exists and works at scale in this repo. **Cost:** the largest item here, which is why it is last among the fixes and first among the things that stop recurrence. **Unblocks:** the whole defect class - writer-with-no-reader, reader-with-no-writer, gate-with-the-wrong-subject - stops being caught by audits and starts being caught by CI. **Changes the call:** nothing found; this is the one recommendation both sources make independently.

### R6 - N-1: the Nick kill switch fails open on a thrown flag lookup

**What.** `NICK_MUTATION_LOCK` is enforced at `lib/trpc/trpc.ts:75-92` and `tool-policy.ts:67-79`; both `catch {}` and proceed. `middleware.ts` in the same repo fails closed on missing auth config, with a comment recording the incident. **Evidence: A.** Narrow exposure: `feature-flags-registry.test.ts` guarantees the flag resolves in the common case; only a thrown exception reaches the fail-open path. **Cost:** a third test case ("flag resolution throws") plus a deliberate choice of failure direction, applied at both points. **Changes the call:** an operator decision that a flag-store outage should not freeze Nick - that is a legitimate call, but make it, and write it next to the code.

### R7 - Decide `/business` (operator decision - see seam 3)

Routable, auth-gated, maintained, de-linked from nav since `1b8a9453b`, and still referenced by three AI-facing modules (`context-hints.ts`, `tool-result-registry.tsx`, `page-visit/route.ts`) - the model can route the operator somewhere the operator cannot navigate (**A**, both sources). Its Clients tab is the coaching CRM, not the tire shop. Options: delete; move the shop tabs to Nick's Tire Admin and keep the CRM somewhere navigable; or re-link. Not an engineering default.

### R8 - `langfuse: false`, `sentry: false` in production

`/api/version` reports both off (**C**, re-confirmed 22:49Z). If tracing and error reporting are meant to be on, they are receiving nothing. What that disables is **I**. Cost: an env check. Changes the call: they are off on purpose.

### R9 - Dependency lag (defer)

`ai@6.0.162` with provider packages a full major behind 7.x (brief B.2, **A** for the pins; the currency claims are the brief's web research, not re-verified here). Not a defect; a migration with named breaking changes. Defer until R1-R5 land.

---

## 3. What was NOT investigated - carried forward as gaps, not buried

**The largest gap is structural: the audit was read-only, so no authenticated control was ever exercised end to end.** Every wiring finding is code plus unauthenticated HTTP. The handler -> API -> authz -> DB -> UI round trip was not executed for any control (FINAL 19). Closing it needs an authenticated session and write permission.

Not investigated at all (audit 4, 15.4, 19; brief D.5): webhook signature verification for `stripe`, `make`, `nickstire`, `inbound-crm` (Telegram's was read and is fine) - SSRF via URL-fetching tools - upload/attachment handling - token storage and rotation - CSRF - rate limiting - audit-log integrity - backups/retention - database schema, indexes, N+1 - job retry/idempotency - PWA/service worker/offline - performance and bundles - accessibility beyond the a11y test's own shape - retrieval quality - whether all ~181 chat tools dispatch through `checkApprovalGate` (the gate exists and is called on the agent path; full coverage is **I**) - whether the 152-tool gap between the 29-entry registry and ~181 tools is scoping or drift - whether `BrainMemory.confidence` is calibrated - the ontology pass - competitive/OSS/frontier research (correctly deferred; the brief's web findings in B are the only material there and were not re-verified by the audit).

**Deliberately deferred by both sources:** Home, Missions, Settings deep-dives - under reconstruction (#2052/#2053/#2055 merged mid-audit). Audit them after the rewrites settle.

---

## 4. What is good and should not be touched

Load-bearing: a plan that reads as pure indictment gets discounted, and these are why the P0's blast radius is a bundle rather than a database.

- **The action-language contract** (`finalize-system-prompt.ts:395`) plus `action-claim-detector.ts`: the model may not claim a side effect in completion tense because actions run after the stream. The audit called it the single most impressive thing in the codebase. Keep it.
- **The capability registry + `evaluateToolAction` + `withGuardian`**: 29 entries, 7 external-mutation tools, **0 ungated**; local shell and filesystem `blocked`; code execution sandboxed and manual-only. Three production callers, not a document nothing reads.
- **`guardianBypassStorage`** is set only inside `executeApprovedToolAsync` - correct, not a hole.
- **The email path**: `sendEmailWithAudit` has two callers, both session-gated; no AI tool reaches it. The claim "only Nour, never autonomous" is true.
- **`middleware.ts`** fails closed on missing auth config, has a nonce + `strict-dynamic` CSP single-sourced with a written reason, and an end-anchored matcher with the motivating bug recorded. R1 is one line away from a file that is otherwise the right shape.
- **`route-policy.ts`** carries a stated invariant per public entry and documents two prior prefix-bleed incidents.
- **`verify-crons.ts`** and **`guardian-registry-drift.test.ts`** - the templates for R5.
- **`nav-items.ts`** as the single IA source for tab bar, MORE sheet and Cmd-K.
- **Provenance**: `source` on every memory write; `readMessageProvenance()` shared by REST and tRPC; `AuditEvent` on ingestion.
- **`TOOL_DATA_FENCING_RULE` appended after the trim** - the ordering is the point; R3 must preserve it.
- **`ApprovalRequest`** with a monotonic status machine and an atomic claim - durable approval, already correct.
- **`/scoreboard` and `/goals` redirect stubs** exist so ~20 references and old links keep working. A DELETE row for them breaks working redirects.
- **`WorkItem` is a queue; never merge it into `Task`** (agent memory; both sources defer to it).

## 5. NEVER, on this evidence

- No policy engine (Cedar/OPA/Casbin) and no durable-execution framework - both fail the net-complexity rule outright; the existing pieces already do the job (FINAL 17.5).
- No CRDT / local-first layer: Yjs REJECT (single operator, no concurrent editing); XState and Dexie DEFER - nothing displaced them and nothing needs them (brief B.1).
- No WCAG 3.0 target; WCAG 2.2 AA stands (brief B.6).
- No retrieval re-architecture on blog evidence; a prior session refuted iterative retrieval with numbers, and the "under 1,000 docs" threshold has no primary source (brief B.5).
- No confidence percentages in any of the above.

## 6. Monday, in order

1. **PR A (code, alone):** R1 + R2 - middleware fix, middleware-subject test that fails first. Deploy. Re-probe `/decisions/1.2` for 307. "Merged" is not "fixed."
2. **PR B (code):** R3, then R4, then R5 - each with a test that fails before and passes after, run through the production path.
3. **Operator decisions, not PRs:** R6 failure direction, R7 `/business`, R8 whether tracing is meant to be on.
4. **After Home/Missions/Settings settle:** the deferred passes in section 3.
5. **Test seam 2** when a finished 56-item report exists: are the runtime rows NOT VERIFIED while every heading is present, and does the wiring audit carry a denominator?
