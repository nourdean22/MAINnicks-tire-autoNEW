> ## 2026-11-02 · People "Needs info" engine unblocked after the backfill · 1 ship
>
> Nour: the /people counts read the same after the backfill. Prod read (read-only, 2026-11-02 ~21:45Z): the backfill did land (39 ledger rows) and it already moved Neglected from 7 to 14 when run 1 landed on 10-31; run 2 added 3 rows, so nothing moved after it. It never touches role, notes or trust, and the engine that proposes those had made 1 model call in 10 days.
>
> - **Root cause.** The enrich pass skipped anyone with ANY pending suggestion. W2 (PR 3425) parks cadence proposals in the same `pendingClassification` slot, so on 10-30 it filled 16 of 20 people, 9 of the 10 "Needs info" people among them, and the role and notes pass never ran for them again.
> - **Second cause.** Its only context was ledger notes, and every note on the 10 sparse people is the generic `interaction reported in chat (...)` line the backfill writes: a contact happened, nothing about the person.
> - **Fix** (`lib/brain/people-intelligence.ts`). A cadence-only proposal no longer blocks; the role and notes suggestion is merged into it, so one Accept applies both. Generic notes are not context; up to 3 snippets of his OWN chat messages naming the person (whole word, newest first) top it up. A failed chat read returns `enrich: "chat_read_failed"`, never a quiet night. Still 5 model calls a night, still suggest-then-approve.
>
> - **Second reader** (Codex was usage-limited): a dismissed role or notes suggestion now stays away 30 days (`metadata.enrichProposedAt`, the cadence rule), since the chat path re-runs the engine every 6 hours; and the write is a compare-and-swap on the `pendingClassification` it read, so an answer he gives mid-run is never overwritten (P2025 = skipped, not a failure). The JSON equality filter was proven read-only on prod.
>
> **Flagged · NOT fixed**
> - Dismiss clears the merged cadence along with the role and notes (one banner, one answer).
> - `lib/ai/agent-actions/person-actions.ts` (Nick's path) still replaces the whole suggestion, so it can wipe a merged cadence. Pre-existing.
> - The 39 backfill rows keep their generic note text; rewriting them is a production write.
