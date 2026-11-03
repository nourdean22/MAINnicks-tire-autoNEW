> ## 2026-11-03 · The phone hears about goal check-ins due and the weekly review (job 2026-11-02-nour-os-interconnect, R2a) · 1 ship
>
> Nour, 2026-11-03 10:08 EST: "i think we have alot of these and also audit them if not upgrade them too". The R1 audit found two signals that existed and never reached the phone: goals due a check-in (`pickCheckInDue`, lib/brain/goal-pace.ts, read only by Home) and the weekly review (the `weekly_review_nudge` category had no writer).
>
> - **Check-in count on the morning push.** `pushBodyFromBrief(text, checkInsDue, weeklyReviewReady)` (lib/inngest/functions/morning-brief.ts) adds "N goals need a check-in" (singular "1 goal needs") after the private-section cut, with room kept so the 200-char cap never cuts it. It is a count only: the read selects no title, and the Goals section stays cut (PR #3221). `countCheckInsDue` makes Home's read (active goals, each goal's newest check_in event) and counts with the same `checkInOverdueDays >= 0` test `pickCheckInDue` uses. A failed read logs `check_in_count_failed` and adds no line; the brief still ships.
> - **"Weekly review is ready" on the morning push, once per ISO week.** Manager ruling 2026-11-03: the weekly-review cron fires around 22:00-23:00 ET, and `sendPush` holds a medium push from 21:00 to 07:00 ET (push.ts:216-219), so a night push never buzzed. Level high at night would break the quiet hours Nour asked for in the home-pulse job, and one buzz he already gets beats a second one. So the line rides the 05:00 ET brief (level high), after the count line. `claimWeeklyReviewLine` looks for the review row keyed `weekly:<this Monday>` or `weekly:<last Monday>` (the cron writes Sunday night under that week's Monday). Newest wins, and it selects the key only, never the review text. It then claims `weekly_review_nudge` / `YYYY-WNN` (the review's week) with a create: P2002 means an earlier brief this week took it, so no line. Any other read or create error: no line. The claim is released by its own id when the brief reached nobody (push and Telegram both failed) or the push threw, so the next brief can carry it. The Telegram fallback carries both lines.
> - **The weekly-review route no longer pushes.** It reports whether its row landed (`persisted`) and leaves the line to the brief.
> - **The marker survives the sweeps.** Written directly (marked `brain-memory-direct-write:`; morning-brief.ts was already on the ratchet allowlist), not through remember(). It has no `expiresAt` and confidence 1.0: pruneNoise's expiry arm needs `expiresAt < now` and its stale arm `confidence < 0.1`. data-cleanup's hard delete (app/api/cron/data-cleanup/route.ts:93) needs one of the same two, and config/retention.ts has no row for the category. The category joins `CONSOLIDATION_EXCLUDE_CATEGORIES`, like `proactive_push_sent`. Its doc comment now names the real writer.
>
> **Receipts.** First pass, red before any code: 15 failed / 17 passed. After the ruling, red again before any code: 11 failed / 25 passed. Green: 10 files, 83 passed, in ET and with TZ=UTC from Git Bash. Mutations, all red:
> - Drop the marker check: the line appears twice in one week.
> - Drop the release: "reached nobody releases the claim".
> - Drop the private-section cut: the planted goal title leaks.
>
> `pnpm typecheck`, eslint on the touched files and `check:raw-sql` all exit 0.
>
> **Flagged · NOT fixed**
> - `weekly_review` itself is not in `CONSOLIDATION_EXCLUDE_CATEGORIES`. If the nightly merge (03:00-04:15Z) soft-deletes a fresh review row, the brief finds no row (`deletedAt: null`) and shows no line. Not checked against prod.
> - The push body's own comment says the OS trims at about 120 characters, and both lines sit at the end, so a long brief may hide them in the collapsed preview.
> - A manual mid-week rerun of the review writes `weekly:<this Monday>`. The next brief then claims that week, and Sunday's real review for the same week gets no line.
