# Chat Error Closeout — `chat:post-process` `.match` crash + honesty hardening

**Date:** 2026-06-10
**Scope:** apps/statenour → Railway `statenour-web` → bdnick.info
**Author:** production-reliability closeout session (autonomous, push-authorized)
**Predecessor audit:** [CHAT-TRANSCRIPT-ERROR-AUDIT.md](./CHAT-TRANSCRIPT-ERROR-AUDIT.md) — recovered the
session and confirmed the errors but did **not** patch code (the exact source line
could not be localized from the minified production stack).

This closeout finishes the job: the crash is now localized to one exact line and
fixed defensively, plus four adjacent honesty / route-hygiene findings are closed.

---

## 1. Production state audited

| | |
|---|---|
| origin/main at worktree base | `24656bbf` |
| `statenour-web` deployed SHA (pre-fix) | `edf6fcce` |
| bdnick.info | 200 |
| `/api/health` | healthy |
| Latest operator chat session | *(redacted)* — "Catching up on Spider Noir", 2026-06-10 00:27–00:49 UTC, 29 msgs, chat-only, **no** side-effect action receipts |

Investigation was **read-only** (a throwaway `railway run` probe, deleted after use).
No transcript content is reproduced here.

---

## 2. Errors confirmed

| Error | Count (latest session) | Severity | Status |
|---|---|---|---|
| `chat:post-process` `TypeError: Cannot read properties of undefined (reading 'match')` | 3× | Silent (error-captured, background) | **FIXED** |
| Empty assistant response → fallback | 1× | Graceful (handled fallback) | **No code change** (see §5) |

Aggregates were otherwise healthy: `/system/logs` clean, `/system/actions` had pending
approvals but **0 failed executions**, `/system/digest` receipts **10 ok / 0 failed**.

---

## 3. Root cause — localized to one line

The crash lived in the **content-feedback** deferred post-process step in
[lib/services/chat/persist-assistant-turn.ts](../../lib/services/chat/persist-assistant-turn.ts),
wrapped in `withErrorCapture("chat:post-process", …, { timeoutMs: 3000 })` — which is
exactly why it surfaced as a silent, repeating `chat:post-process` `ai_error` rather
than breaking the user's response.

The step builds `priorText` from the previous assistant message, then runs
`priorText.match(/#\w+/g)` (hashtag heuristic). The old code:

```ts
const priorText = priorAssistant
  ? (Array.isArray(priorAssistant.content)
      ? priorAssistant.content.map((c) => c.text ?? "").join("\n")
      : (priorAssistant.content as unknown as string))   // ← the lie
  : "";
```

An AI-SDK assistant turn can carry `content: undefined` (parts-only messages). When
that prior turn is **not** an array, the `as unknown as string` cast tells the
compiler "trust me, it's a string" — but at runtime it yields `undefined`, and the
next `priorText.match(…)` throws. The earlier audit's note that "`priorText` defaults
to `''`" was incomplete: the `: ""` default only fires when `priorAssistant` itself is
absent, **not** when its `content` is undefined.

### Localization table

| Candidate step | Evidence for | Evidence against | Disposition |
|---|---|---|---|
| **content-feedback** (`persist-assistant-turn`, timeoutMs 3000) | direct unguarded `.match()` on a value derived from a lying cast; matches domain + timeout wrapper | — | **CONFIRMED root cause** |
| `processConversation` (pipeline-controller) | parses text | whole body wrapped in local `try/catch` → swallowed, never logged as `ai_error` | ruled out |
| hallucination-guard / fact-check / friction / outcome / auto-rename | each parses text | no unguarded `.match` on nullable input found | ruled out |
| chatgpt-processor / memory helpers | regex usage | inputs already string-normalized | ruled out |

---

## 4. Fix made (defensive, minimal, tested)

New pure helper [lib/ai/chat/message-text.ts](../../lib/ai/chat/message-text.ts) —
`messageContentToText(content: unknown): string` — always returns a string (joins
array parts' `text`, passes strings through, returns `""` for undefined/null/number/
object). The content-feedback step now calls it instead of the cast. Behaviour for
valid string / array content is unchanged; only the crash path changes.

Unit test [lib/ai/chat/message-text.test.ts](../../lib/ai/chat/message-text.test.ts)
(6 cases): plain string, **undefined (the exact crash case)**, null, array-join,
parts-without-text, numbers/objects, and a `.match`-safety regression assertion.

The error capture is preserved — no error is globally swallowed; a real future failure
in any post-process step still records as `chat:post-process`. We did **not** spray
guards across unrelated helpers (the localization was confident, so the broad
step-name-observability fallback from the mission was unnecessary).

---

## 5. Empty assistant response (Phase 3)

Investigated, **no code change**. It is independent of the `.match` crash (that crash
is deferred/background and runs *after* the response streams — it cannot blank a
response). The single event was a provider-empty turn, already caught by the existing
empty-response fallback, which shows the operator a clear "didn't produce a response,
retry" message. Per scope we do not touch the provider/model, and the fallback copy is
already honest and actionable — so nothing safe to improve here.

---

## 6. Integration-down insight (Phase 4)

The session's friction came from web-search / GitHub / Google / Voice / Browser being
unavailable, and the model giving weak/evasive answers about it. Root cause was a
**self-inflicted prompt rule**: the FORBIDDEN PHRASES block in
[finalize-system-prompt.ts](../../app/api/ai/chat/finalize-system-prompt.ts) banned
"I don't have real-time access" as a generic AI deflection — which also silenced the
*honest, specific* disclosure ("web search isn't available right now").

Fix (small, wording only):
- Narrowed that forbidden bullet so generic deflection stays banned but a **specific**
  tool-unavailability statement is explicitly encouraged.
- Added a **TOOL UNAVAILABILITY** rule to the HONESTY+RESPECT block: if a tool isn't
  attached / configured / errored, say so plainly and specifically; never imply you
  checked when the tool didn't fire; never say "I found nothing" when the truth is you
  couldn't look.

No new integrations, no credential changes.

---

## 7. Action-honesty insight (Phase 5)

Recurring `chat_claim_warn` events over the week flag claimed `createTask` /
`completeTask` actions where no tool fired. The detection + correction machinery
already works (`detectActionClaimsWithoutTools` → warn; `rewriteForFabrication` →
`[VERIFIER]` banner; ActionClaimWarning chip). The gap is **prevention**, i.e. prompt
reinforcement.

Fix (small, wording only): added a **TOOL CONFIRMS ACTION** rule to the HONESTY+RESPECT
block — never write a past-tense action verb (added/created/sent/saved/scheduled/
marked done/pinned) unless the matching tool fired this turn; otherwise offer the next
step ("I can create that — want me to?"). The detector/rewriter are untouched; truth
standards are not weakened; no fake receipts.

---

## 8. `/system/errors` dead route (Phase 6)

`/system/errors` 404'd while the `/system` hub KPI hint and RUNBOOK still pointed to
it (the page was consolidated into `/system/logs`). Fix:
- New redirect page [app/(mastery)/system/errors/page.tsx](<../../app/(mastery)/system/errors/page.tsx>)
  → `/system/logs` (keeps every legacy link working).
- `/system` hub error-KPI hint now reads "Check /system/logs".
- RUNBOOK error-triage page-refs retargeted to `/system/logs`.
- The unrelated API route `app/api/system/errors/route.ts` is left untouched.

---

## 9. Verification

- `pnpm typecheck` — 0 errors (run from the worktree, not the main checkout)
- `pnpm test` — 233 files / 3222 tests passed (incl. the 6 new `message-text` cases)
- `pnpm build` — see push gate result in the session report
- **Production runtime verification — PENDING post-deploy** (filled in the follow-up
  commit once `statenour-web` deploys the fix): bdnick.info 200, `/api/health` healthy,
  `/chat` + `/system/logs` + `/system/errors` redirect + `/system/digest` +
  `/system/actions` load with no new console errors, and a controlled benign chat turn
  exercises post-process without producing a new `chat:post-process` `.match` error.

---

## 10. Privacy handling

- Read-only production investigation; throwaway probe deleted after use.
- No raw transcript dumps; session id redacted.
- No private health / marriage / business detail recorded.
- No data mutation, no migration, no backfill; no memories/tasks/chats/receipts touched.

---

## 11. What was NOT done / HOLDs

- **No provider/model change** (out of scope).
- **No broad chat-pipeline rewrite.**
- **Empty-response fallback** left as-is (works; provider-side cause).
- Step-name observability for the *other* deferred post-process steps was **not** added
  — the root cause was localized, so it would be churn without a current failure to
  catch. Worth doing if a *new* `chat:post-process` error ever appears without an
  obvious line.
