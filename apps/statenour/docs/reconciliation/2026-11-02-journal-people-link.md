> ## 2026-11-02 · Journal entries linked to people (W4, job nour-os-interconnect) · 1 ship
>
> Nour: "dont forget the people and the journal and the home page lets make sure its all interconnected". Map gap 5: People and the journal shared no key; a name in the journal was free-text `linkedTopics`.
>
> - **Column.** `brain_dumps.person_ids` (migration `20261102200000_brain_dump_person_ids`, hand-applied, NOT applied by this PR). Only brain_dumps: it is the one silo whose writer extracts people; reflections are written by the composer, the dump-derive copy (its parent dump carries the ids) and the AI reflect route.
> - **Writer.** `ingestJournal` asks the extraction for `people: [{ name, interacted }]`; `lib/services/people/journal-link.ts` resolves each name with `resolvePersonByName` (`createIfMissing: false`) and keeps only `exact` or the ONLY case-insensitive match. Fuzzy tiers are refused: they return the first near name with no tie check.
> - **Ledger.** One row per interacted person per entry through `recordInteractionOnce` (source `journal`, `at` = `noRowSince` = entry createdAt, no XP, note = his first 160 chars). A mention links the entry but writes no contact (the 2026-09-16 rule).
> - **Readers.** `/api/people` adds `latestJournal` and `reads.journal` (a failed read is "failed", not empty); the /people card shows "Journal, <when>: <excerpt>"; journal rows show the people as links to `/people?inspect=person:<id>`.
>
> **Flagged · NOT fixed**
> - Old entries carry no ids; a backfill over them is an operator-cleared prod write.
> - The resolver writes a `people_intelligence_merge` audit row for every case-insensitive or fuzzy hit, including the fuzzy ones this gate refuses (`lib/brain/person-profile-fuzzy.ts`, not this lane's file).
> - The resolver header says Levenshtein catches "Dania" vs "Danai"; that pair is a transposition (Levenshtein 2) and resolves in the Jaro-Winkler tier.
> - Short names ("Mo") need the profile to be named exactly that; a profile named "Mohammed Ali" is not matched from "Mo".
