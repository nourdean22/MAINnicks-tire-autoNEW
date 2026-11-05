> ## 2026-11-05 · People nicknames: metadata.nicknames, every name-matching path, the /people drawer and Nick · 1 ship
>
> Branch `statenour/people-nicknames` (job 2026-11-05-people-nicknames). No migration, no new table.
>
> - Store: `PersonProfile.metadata.nicknames`. Reader and rule: `lib/people/nicknames.ts`; writer:
>   `lib/services/people/nicknames.ts editNicknames`, a compare-and-swap on the metadata it read. The people engine's
>   two stamps are pinned the same way, so a nickname saved during a model call survives.
> - Rule: a nickname points at a person only when one live person uses it and no live person is named it. Whole word,
>   any case, sentence start included, never fuzzy. Resolver tier 3 (`matchTier: "nickname"`, `"shared_nickname"`).
> - Paths: the resolver (person.*, digest, journal gate, promise link, Telegram /log, logPersonInteraction, createPerson),
>   `namedInText`, journal excerpts, calendar line, `chatSnippets`, kept-word, recall, the customer lookup tool, Cmd-K,
>   open promises on the card.
> - Left on the name only: `scripts/people-backfill.ts` and `scripts/backfill-journal-person-ids.ts` (re-linking old rows
>   is a separate decision), co-mention counts in `network-analysis` and `social-proof-aggregator` (substring needles),
>   `/api/people/search` (no caller).
> - Nick's person.update takes `nicknames` and `removeNicknames`; the /people edit drawer saves each change at once.
> - Guards: no pronoun or descriptor is ever a nickname (`isNonName`, now in `lib/people/non-name.ts`). Nick writes one
>   only on an exact, case-insensitive or nickname match, and never a word someone else uses or is named; the drawer may.
