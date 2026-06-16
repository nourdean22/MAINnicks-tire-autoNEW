# ADR-0016 · Statenour OS upgrades · honesty verifier + inbox triage design

> **Status**: Accepted (2026-06-15)
> **Date**: 2026-06-15
> **Decision drivers**: 
> 1. False claims of completed actions in chat can mislead the operator. A failsafe validator is required to intercept tool calls and background executions.
> 2. Journal takeaways need a safe way to escalate into tasks without duplicating efforts or drifting domains.
> 3. The 200+ task inbox backlog requires a fast mobile-friendly triage interface. Native browser confirm popups (`window.confirm`) are suppressed on iOS standalone PWAs, requiring in-DOM two-tap patterns.

---

## Context

In our daily execution under Statenour OS, we identified three major workflow bottlenecks and one critical safety issue:

1. **Honesty Verification:** When the assistant makes an API tool call or queues background work, if a failure occurs (e.g. invalid permissions, API timeout, or DB lock), the assistant might still textually claim "I have successfully completed X." This false confidence misleads the operator.
2. **Journal Escalation:** The Journal convergence system distills daily takes into "next actions", but there was no native way to promote those takes directly into the tasks system.
3. **Inbox Triage Backlog:** Nour has an inbox task queue containing 200+ uncategorized items. Sorting these requires a fast, mobile-friendly interface.
4. **PWA Alert Suppressions:** In standalone iOS Progressive Web Apps (PWA), standard browser dialogs (`window.confirm`, `window.alert`, `window.prompt`) are suppressed by the operating system, causing silent freezes or unclickable loops.

---

## Decision

We implemented a coordinated wave of upgrades across the chat, task, journal, and diagnostic systems:

### 1. Two-Tier Honesty Verification

We integrated honesty verification checks directly inside [persist-assistant-turn.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/services/chat/persist-assistant-turn.ts):

* **Synchronous Tool Verification:** We intercept tool responses during processing. If an SDK tool call reports an error or fails, we:
  1. Prepend `[VERIFIER · v10.0.162]` warning banner to the message content.
  2. Log a `chat_claim_warn` entry inside `BrainMemory` with a trace-mapped key (e.g. `sdk-fail-${traceId}`).
* **Asynchronous Background Action Audits:** In `runDeferredBackgroundWork`, if a deferred mutation fails, we:
  1. Log a `chat_claim_warn` to `BrainMemory` under `action-done-fail-${traceId}`.
  2. Rewrite the database `ChatMessage` row (content, parts, and searchableContent) to insert the verifier warning banner, alerting the user to the failure.

### 2. Journal-to-Action Seam

We created the `promoteNextAction` mutation in [journal.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/trpc/routers/journal.ts) to bridge the two modules:
* **Idempotency:** Utilizes a metadata flag `nextActionPromoted` inside the take JSON. Subsequent calls on the same take exit early.
* **Domain Routing:** Resolves nextAction domains (e.g. `business`, `personal`) to their canonical general anchor projects (such as `m-general-business`) or defaults to the inbox.

### 3. Task Inbox Triage Flow

We implemented a Things-style inbox triage interface:
* **TRPC Triage Mutation:** Created the `triage` mutation under `taskRouter` in [task.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/trpc/routers/task.ts) to process 6 quick triage actions:
  - `today`: status `"READY"`, sets `dueDate` to the start of today.
  - `schedule`: status `"READY"`, sets `dueDate` to the chosen date.
  - `anytime`: status `"READY"`, assigns to project/mission, clears inbox classification.
  - `someday`: status `"WAITING"`, overrides priority to 70.
  - `snooze`: status `"WAITING"`, sets `snoozedUntil` date.
  - `kill`: invokes `deleteTask()`.
* **Mobile-First Triage UI:** Designed and mounted the `<InboxTasksTriage />` component in [inbox-tasks-triage.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/components/home/inbox-tasks-triage.tsx) on the main page.
* **Two-Tap Deletions:** Rather than triggering native `window.confirm` dialogs (which are suppressed in PWA mode), task deletion requires a two-tap inline DOM pattern (initial tap shows "Confirm?", second tap executes).

### 4. Google OAuth Diagnostics

To debug re-auth failures across primary (`moeseuclid@gmail.com`) and personal (`nourdean22@gmail.com`) accounts, we added:
* **Diagnostics CLI:** A diagnostic utility [google-oauth-diagnostics.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/scripts/google-oauth-diagnostics.ts) that dumps integration keys, status, last sync times, and failure counts.
* **Runbook:** Created [google-oauth-reauth.md](file:///C:/Users/nourd/NOURCITY/docs/operations/google-oauth-reauth.md) outlining diagnostics and OAuth start links.

---

## Consequences

### Positive

* **Honest Chat System:** Assistant can no longer claim successful completion of actions that failed behind the scenes.
* **Streamlined Backlog Processing:** The 200+ inbox items can be triaged rapidly on a mobile phone during gaps in the day.
* **Idempotent Promotions:** Pinned journal insights are elevated to the task list exactly once.
* **PWA Safety:** All triage buttons, including deletions, are 100% functional inside standalone iOS wrappers with no risk of alert lockups.

### Negative

* **DB Mutation Rewrites:** Overwriting message rows after background job failure adds minor database write overhead.
* **Any Cast Limits:** Bypassing TypeScript interface limits for `pendingClassification` in UI-routing required a typecast (`any`) to prevent compiling blocks.

---

## Operator Action Items

1. **OAuth Verification:** Run the OAuth diagnostics script in PowerShell to verify account integration health:
   ```powershell
   cd C:\Users\nourd\NOURCITY\apps\statenour
   pnpm exec tsx --env-file=.env.local scripts/google-oauth-diagnostics.ts
   ```
2. **Inbox Sweep:** Open `/` on the deployed OS (mobile or desktop) and use the Triage card to sort outstanding inbox items.

---

## References

* [persist-assistant-turn.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/services/chat/persist-assistant-turn.ts)
* [journal.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/trpc/routers/journal.ts)
* [task.ts](file:///C:/Users/nourd/NOURCITY/apps/statenour/lib/trpc/routers/task.ts)
* [inbox-tasks-triage.tsx](file:///C:/Users/nourd/NOURCITY/apps/statenour/components/home/inbox-tasks-triage.tsx)
* [google-oauth-reauth.md](file:///C:/Users/nourd/NOURCITY/docs/operations/google-oauth-reauth.md)
