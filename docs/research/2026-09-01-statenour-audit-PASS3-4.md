# StateNour Deep Audit - PASS 3-4

**Product boundary (§6) and Nick's permission / autonomy architecture (§15, §32, §45).**

Continues `2026-09-01-statenour-audit-PASS0-2.md`. Same pinned snapshot:
`origin/main @ 0e6d2301cd19aaef34e22dc6f24a529eb1333bf3`, which `/api/version`
confirms is the running production build. Read-only; nothing was modified.

Evidence classes as before: **A** verified code · **C** verified runtime ·
**H** hypothesis · **I** unknown/not verified.

---

## 7. THE CENTRAL STRUCTURAL FINDING OF THIS PASS

StateNour has **two safety boundaries, built by the same team to two very
different standards.**

| | Agent / tool boundary | HTTP / auth boundary |
|---|---|---|
| Declared model | Capability registry with `riskClass`, `approvalPolicy`, `writeAccess`, `externalMutation`, `memoryWriteAllowed`, `auditLogRequired`, `status` | Public-path allowlist (`route-policy.ts`) |
| Enforcement | `evaluateToolAction` -> `checkApprovalGate` -> `withGuardian`, plus a global mutation kill switch | `middleware.ts` |
| Canary | `guardian-registry-drift.test.ts` - scans **source** for every wrap site, asserts each is either a registered capability or explicitly `reliabilityOnly`, **plus an inverse check** that a `reliabilityOnly` id can never be a gated/mutating tool | `route-policy.test.ts` - tests `isPublic()` only |
| Subject coverage | **Complete** - the canary enumerates call sites, not just verdicts | **Partial** - the canary never imports `middleware.ts` |
| Result | No ungated external-mutation tool found | **Live unauthenticated bypass in production** (PASS 0-2, W-4) |

This reframes the whole audit. The problem is not that this team does not test
safety controls - the tool boundary is defended to a standard most production
systems never reach. The problem is that **the discipline is unevenly applied,
and the under-defended seam is the one facing the public internet.**

The most useful single action available is to port the
`guardian-registry-drift.test.ts` pattern - *enumerate the call sites, assert
the subject* - onto the auth boundary and onto the UI mount graph.

---

## 8. PASS 3 - NICK PERMISSION / AUTONOMY ARCHITECTURE

### 8.1 Verdict: the capability system is real and enforced (Class A)

I set out to test whether `lib/tools/tool-registry.ts` is a well-written
document that nothing reads. **It is not.** `evaluateToolAction` has three
production callers:

```
lib/ai/runtime/approval-gate.ts:29   <- the human-in-the-loop gate
lib/tools/guardian.ts:403            <- inside withGuardian()
lib/trpc/routers/system/tools.ts:41  <- read-only policy preview
```

and `checkApprovalGate` is called on the agent action path at
`lib/ai/nick-agent.ts:147`, where a gated action returns
`GATED: Operator approval required (ID: ...)`, persists an `ApprovalRequest`
row, and publishes an `approval.required` cockpit event.

**Correction to my own working note:** my first grep for `evaluateToolPolicy`
returned zero callers, which would have been a headline finding. The exported
symbol is `evaluateToolAction`. I had grepped a name that does not exist. The
"unenforced registry" claim was wrong and is withdrawn.

### 8.2 The permission matrix (Class A)

29 capability entries. Extracted with an indentation-aware parser that reads
only top-level entry fields (see §10 - my first two parsers produced wrong
output).

**All 7 tools with `externalMutation: true` - the ones with real-world
consequences:**

| Tool | Risk | Approval | Status | Audit |
|---|---|---|---|---|
| `browser.act` | critical | `screenshot_required` | **inert** | yes |
| `github.create_pr` | high | `owner_required` | restricted_active | yes |
| `github.create_issue` | high | `owner_required` | restricted_active | yes |
| `gmail.compose_draft_card` | high | `owner_required` | restricted_active | yes |
| `gmail.sendDraft` | high | `owner_required` | active | yes |
| `google.proposeEvent` | high | `owner_required` | active | yes |
| `shop.sendSms` | high | `owner_required` | active | yes |

**Ungated external-mutation tools: 0.** Every one requires an owner gate or a
screenshot gate, and every one is audit-required.

Critical-risk tools:

| Tool | Approval | Status |
|---|---|---|
| `code.run_js_vm` | `manual_only` | active |
| `code.run_python_e2b` | `manual_only` | active |
| `local.file_access` | `manual_only` | **blocked** |
| `local.shell` | `manual_only` | **blocked** |
| `browser.act` | `screenshot_required` | **inert** |

Local shell and local filesystem access are `status: "blocked"` with the note
*"Explicitly blocked for safety."* Code execution is sandboxed (E2B / local VM)
and manual-only. This is a defensible posture.

### 8.3 The email claim verifies end to end (Class A)

`/api/email/send` documents *"Auth: requireSession() - only Nour, never
autonomous."* I traced every caller of the underlying `sendEmailWithAudit`:

```
app/api/email/send/route.ts:51     <- requireSession(), zod-validated
lib/trpc/routers/chat.ts:215       <- operatorProcedure (session + mutation gate)
tests/api/all-clear-on-failure.test.ts  <- test only
```

No AI tool reaches it. The `composeEmail` tool is catalogued as
*"Inline renderer only"* - it renders `<EmailDraftCard />`, and the human
presses Send. **The claim is true.** Both consumers share one service function
so the two paths cannot drift, which is the same pattern used for
`social.publish`.

### 8.4 Authorization defaults are correct (Class A)

`operatorProcedure = t.procedure.use(enforceOperator).use(mutationGateMiddleware)`.
Across all 32 tRPC routers:

- `publicProcedure`: **3 uses**, all in `system/notifications.ts`
  (`sessionExpiry`, `pushVapidKey`) - and `/api/trpc` is not on the middleware
  public allowlist, so even those require a session at the edge. Defense in depth.
- `ownerProcedure` / `protectedProcedure`: 0 - the codebase has one gated
  procedure type, not a confusing ladder.

### 8.5 The guardian bypass is correctly scoped (Class A)

`guardianBypassStorage` (AsyncLocalStorage) short-circuits the approval gate
when set. I audited every site that sets it. All four `.run(true, ...)` calls
are inside `executeApprovedToolAsync` (`guardian.ts:108/120/126/130`) - i.e.
they run an action **the operator has already approved**, so the gate is not
re-evaluated and cannot loop. No other code path enables the bypass.
**This is correct, not a hole.**

### 8.6 FINDING N-1 (MEDIUM) - the Nick kill switch fails OPEN

`NICK_MUTATION_LOCK` is the global freeze on Nick's mutations. It is enforced
in two places, and **both fail open on a flag-resolution error** (Class A):

`lib/trpc/trpc.ts:75-92`
```ts
let locked = false;
try {
  const { getFlag } = await import("@/lib/feature-flags");
  locked = getFlag("NICK_MUTATION_LOCK")?.isOn ?? false;
} catch {
  // Flag resolution failure preserves current behavior.
}
if (locked) throw new TRPCError({ code: "FORBIDDEN", ... });
```

`lib/tools/tool-policy.ts:67-79`
```ts
try {
  const mutationLock = getFlag("NICK_MUTATION_LOCK")?.isOn ?? false;
  if (mutationLock) return { decision: "deny", ... };
} catch {
  // safe fallback if feature flags cannot be resolved
}
```

If `getFlag` throws - flag store unreachable, DB down, import failure - `locked`
stays `false` and the mutation proceeds. The second comment calls this a "safe
fallback"; for a kill switch, permitting the action is the unsafe direction.

**Stated fairly, because severity should not be manufactured:** the exposure is
narrow. `tests/lib/feature-flags-registry.test.ts` exists specifically to
guarantee the flag is registered and `getFlag` resolves rather than returning
null (a 2026-07-10 review finding), which closes the common case. Only a thrown
exception reaches the fail-open path.

**Why it still matters:** the conditions under which a flag store becomes
unreachable are correlated with the conditions under which you would want to
freeze Nick. And the inconsistency is internal - `middleware.ts` in this same
codebase deliberately fails **closed** on missing auth config, with a comment
recording that a pre-v10.1 version failed open and that this was the bug. Two
safety controls, opposite failure directions, same repository.

**Also worth noting as a strength:** the lock has a genuine canary pair -
`tests/trpc/mutation-gate.test.ts` asserts mutations proceed when the flag is
false *and* throw `FORBIDDEN` when true; `tests/tools/tool-policy.test.ts` does
the same at the policy layer plus "allows non-mutating queries even when
locked". What is missing is a third case: **flag resolution throws.**

### 8.7 FINDING N-2 (LOW, latent) - inert browser tools carry ungated policy

`browser.extract` and `browser.observe` are `riskClass: high` with
`approvalPolicy: "none"`. This is currently harmless because their
`status` is **`inert`**. It becomes a live gap the moment browser automation is
switched on, and nothing in the registry ties "activating a status" to
"revisiting the approval policy". `calendar.propose_event_link` is the single
write-or-external capability without `auditLogRequired: true`.

### 8.8 Not verified (Class I)

- **Whether every one of Nick's ~181 chat tools dispatches through
  `checkApprovalGate`.** I verified the gate exists, is called on the
  `nick-agent` action path, and that the drift canary prevents unregistered
  wrap sites. I did **not** trace all 181 tool dispatches. `withGuardian` wraps
  ~24 sites, mostly integrations (search providers, rerankers, Gmail), not the
  chat tool list. Establishing full coverage needs either a runtime trace or a
  dispatch-path read that read-only mode did not justify at this depth.
- **Runtime behavior of any approval flow.** No control was exercised.
- The registry documents 29 capabilities against ~181 registered tools. Tools
  absent from the registry hit `evaluateToolAction`'s "Unknown tool ID" branch,
  which **denies** with `requiredApproval: "manual_only"` - fail-closed, and the
  drift canary exists precisely because unregistered ids once silently denied
  chat web search (2026-07-05). Whether the 152-tool gap is intentional scoping
  or drift is **not established here.**

---

## 9. PASS 4 (partial) - PRODUCT BOUNDARY (§6)

### 9.1 The nav is the real IA, and it is already tighter than the route tree

`components/layout/nav-items.ts` is a genuine single source of truth: the bottom
tab bar, the MORE sheet, and the Cmd-K palette all read one `NAV` array,
consolidated from three hand-maintained copies in the 2026-06-18 IA reorg.
That is good architecture and it means **route count overstates the surface the
operator actually sees.**

Top level: Home / Chat / Missions / Journal as bottom tabs; then Stats, Pinned
Memory, Content, Market, Learn, Photo Improver, Short Links, Brain, People,
System, Settings.

### 9.2 FINDING B-1 - `/business` is de-linked but still routable (Class A)

`nav-items.ts` records:

> The money section (`/business` hub) + the external nickstire.org/admin footer
> link were removed 2026-09-01 on operator verdict - both dead in practice.
> **The /business PAGE stays routable; only nav links died.**

`app/(mastery)/business/page.tsx` still renders three tabs described as
*"shop revenue + targets, the lead->retained funnel, and the coaching CRM
(contacts, bookings, agreements)"* - `FinancialTab`, `FunnelTab`, `ClientsTab`.

Under §6 this is squarely Nick's Tire Admin territory: revenue dashboards,
lead funnel, customer/client records. Your own verdict already retired the nav
entry. **The page, its three tab components, and its API dependencies remain
live, auth-gated, and maintained.** Recommendation is DELETE or MOVE, not
merely de-link - a de-linked page is still deployed attack surface and still
costs maintenance, while producing zero operator value by your own assessment.

### 9.3 Shop-operational surfaces still inside StateNour (Class A, inventory only)

Named for the next pass. **This is an inventory, not a verdict** - several may
be legitimate owner-level escalations, which §6 explicitly permits:

```
/(mastery)/business          /(mastery)/market
/api/analytics/revenue       /api/business/location-ranking
/api/crm                     /api/customer-360/[customerId]
/api/financial               /api/nickstire/query
/api/sync/business           /api/system/revenue-decisions
/api/system/tire-stock-requests
/api/telegram/revenue-decision-callback
/api/webhooks/inbound-crm    /api/webhooks/nickstire
/api/cron/ingest-reviews
```

The `shop.sendSms` capability deserves specific attention. It is correctly
gated (`owner_required`, audited) and is plausibly an owner-level escalation.
But it is a **customer-facing external side effect living in the personal OS**,
and agent memory records two relevant incidents: the nickstire SMS activate
landmine, and the operator's own line receiving 18 automated texts. Worth an
explicit keep/move decision rather than inheritance by default.

`/market` (SEO + Radar tabs) is in nav under EXECUTE and is shop marketing.
Boundary question flagged, **not** adjudicated.

---

## 10. INSTRUMENT ERRORS FOUND IN THIS AUDIT (3 so far)

Recorded because the repo's own doctrine says to prove the instrument fired,
and because every one of these produced a confident, plausible, wrong answer
that would have survived review.

| # | Wrong output | Root cause | Caught by |
|---|---|---|---|
| 1 | "76/274 components (27.7%) unreachable" | `os.path.normpath` returns backslashes on Windows; every relative-import edge failed to resolve | Spot-checking 6 claimed orphans against raw grep - all 6 were normal relative imports |
| 2 | "`gmail.sendDraft` is medium-risk with no approval" - an apparent inverted-severity P0 | Flat parser matched fields at any indentation, so nested blocks bled values across entries | Reading the raw registry entry before publishing |
| 3 | "`evaluateToolPolicy` has zero callers" - an apparent unenforced-permission-system finding | Grepped a symbol name that does not exist; the export is `evaluateToolAction` | Listing the module's actual exports |

Two of the three would have been the most dramatic findings in the report. The
lesson is not "be careful" - it is that **every mechanical detector needs a
positive control before its output is trusted**, which is the same
`silent-instrument` rule this repo already documents.

---

## 11. UPDATED ACTION LIST

Merges and supersedes §6 of PASS 0-2. Ordered by evidence x consequence.

1. **Fix `middleware.ts:55`** (P0, live bypass). The correct end-anchored
   asset-extension pattern already exists in `config.matcher` directly below.
2. **Port the drift-canary pattern to the auth boundary.** Test the
   middleware's allow/deny decision, not `isPublic` alone. `guardian-registry-
   drift.test.ts` is the working template, in this repo, today.
3. **Add the third kill-switch test case: flag resolution throws.** Then decide
   deliberately whether `NICK_MUTATION_LOCK` should fail open or closed, and
   make both enforcement points agree with `middleware.ts`'s posture.
4. **Resolve W-1** - mount `GlobalTopTicker` or delete it and fix the layout
   comment that claims priority alerts flow through it.
5. **Decide `/business`** - delete or move to Nick's Tire Admin. De-linked is
   the worst state: still deployed, still maintained, zero value by your own verdict.
6. **Add a UI-mount gate** modelled on `verify-crons.ts` / the guardian drift
   canary; triage the 17 unreachable components.
7. **Tie capability `status` transitions to an approval-policy review**, so
   activating `browser.*` cannot ship `approvalPolicy: "none"` on a high-risk tool.
8. **Investigate `langfuse: false` / `sentry: false` in production.**

---

## 12. REMAINING PROGRAM

| Pass | Status |
|---|---|
| 0-2 snapshot / inventory / wiring | **delivered** |
| 3 permission + autonomy | **delivered** (this file) |
| 4 boundary | **partial** - inventory built, verdicts pending |
| 4 domain model / ontology | not started |
| 5 external frontier | not started (correctly deferred - the program forbids starting here) |
| 6-10 alternatives, falsification, synthesis, migration, verification | not started |
| 11 provenance architecture | not started - the next highest-value target |
| 18 brain / memory / retrieval | not started |
| 30 full threat model | partial - W-4/W-5/N-1 found; injection, webhook verification, SSRF, upload handling untouched |

*Pinned to `origin/main @ 0e6d2301c` = production at time of audit.*
