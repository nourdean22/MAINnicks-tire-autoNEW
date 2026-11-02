> ## 2026-11-02 · People "Needs info" engine unblocked after the backfill · 1 ship
>
> Nour: the /people counts read the same after the backfill. Prod read (read-only, 2026-11-02 ~21:45Z): the backfill did land (39 ledger rows) and it already moved Neglected from 7 to 14 when run 1 landed on 10-31; run 2 added 3 rows, so nothing moved after it. It never touches role, notes or trust, and the engine that proposes those had made 1 model call in 10 days.
>
> - **Root cause.** The enrich pass skipped anyone with ANY pending suggestion. W2 (PR 3425) parks cadence proposals in the same `pendingClassification` slot, so on 10-30 it filled 16 of 20 people, 9 of the 10 "Needs info" people among them, and the role and notes pass never ran for them again.
> - **Second cause.** Its only context was ledger notes, and every note on the 10 sparse people is the generic `interaction reported in chat (...)` line the backfill writes: a contact happened, nothing about the person.
> - **Fix** (`lib/brain/people-intelligence.ts`). A cadence-only proposal no longer blocks; the role and notes suggestion is merged into it, so one Accept applies both. Generic notes are not context; up to 3 snippets of his OWN chat messages naming the person (whole word, newest first) top it up. A failed chat read returns `enrich: "chat_read_failed"`, never a quiet night. Still 5 model calls a night, still suggest-then-approve.
>
> **Flagged · NOT fixed**
> - A dismissed role or notes suggestion comes back the next night (no cooldown, unlike cadence's 30 days). Pre-existing; now reaches more people.
> - The 39 backfill rows keep their generic note text; rewriting them is a production write.
