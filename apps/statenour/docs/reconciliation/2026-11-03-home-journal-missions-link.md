> ## 2026-11-03 · Home, the journal and the missions page read each other (job 2026-11-02-nour-os-interconnect W7) · 1 ship
>
> Map gaps 6 ("Home skips missions and the journal") and 8 ("chat-to-mission links are written and never read"), Sunsama S3/S4, Tana T3.
>
> - **Home.** The brief's lead row names the mission and goal behind the next move (`leadContext`, one `task.findUnique`; the task's own goal overrides the mission's, the inbox mission is not named). A Journal line shows the newest entry (people page's `journalExcerpt`) with its live people as dossier links. Both are `"unknown"` on a failed read and say so.
> - **Journal day view.** Each day header in the feed opens "Done and contacts": that ET day's task completions (with their goal) and relationship-ledger contact rows (`contactRowsOnly`), from `lib/services/journal-day.ts` `dayActivity`, the day-bounded helper beside `relatedActivity`. Each read is named in `failed` when it throws.
> - **Weekly review.** `/journal?review=week`: per active goal, tasks done and grounded entries since the last review (7 days with none, capped at 28); a note per goal saved as a journal entry grounded to that goal (confidence 1, confirmed, `enrichedAt` stamped, no AI call); "Extend a week" / "Close" on WEEK goals through `updateGoal`. Entries are written in one transaction. Goal actions match ids against the server's active list; text is never parsed for ids (canary in `tests/services/weekly-review.test.tsx`).
> - **Missions.** Each expanded mission shows up to 3 linked chats from `chat_conversations.mission_id` (the `conversation-mission-link` cron's first reader), one query for the board, linking `/chat?cid=`.
>
> **Flagged · NOT fixed**
> - Review entries carry `entryType = "weekly_review"`, which `components/journal/entry-row.tsx` TYPE_META does not know, so they show the "raw" icon in the feed.
> - The feed keys reflection / situation / decision rows by their UTC date (`journal-feed.ts:310,334,362`) while dumps and the day view use ET days: an evening entry from those silos sits under the next day's header.
> - `missionChats` reads at most 300 chats newest-first; a mission whose linked chats all fall past that shows none (391 conversations total on 2026-11-02).
