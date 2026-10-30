# Task app benchmark (2026-10-29)

Job `2026-10-29-task-upgrades`, phase 1. Input: Nour's six App Store screenshots (2026-10-29, apps circled in
green, three of them also marked "R": Jarvis "Talk Not Type", Todoist Ramble "Capture tasks at the speed of
thought", Rosebud "A Journal That Knows You") plus each app's public help center and App Store page.

**Method.** reverse-engineer-anything does not apply: it covers binaries, packages and captures of our own
accounts, and these are public third-party apps, so nothing was downloaded, decompiled or signed into. Every
mechanism below comes from public behavior only (screenshots, App Store pages, help centers), read 2026-10-29.
Mechanisms are free to take; no code or assets are copied.

## 1. Answer first: what phase 2 builds

Phase 2 = PR 1's notes and photos UI (decided by the brief, not by this benchmark) plus these three:

1. **Talk, then review: voice brain dump into several tasks** (Todoist Ramble + Jarvis). Nour marked both.
   NOUR OS already transcribes (`app/api/ai/transcribe/route.ts`) and has a mic on quick add
   (`components/missions/missions-quick-add.tsx:97`), but one recording becomes one text line. The steal is the
   split into many tasks with a preview list you fix before anything is saved. About 1 day.
2. **Recall line in task detail** (Rosebud long-term memory + Jarvis "it remembers you"). Nour marked both.
   NOUR OS has the memory (BrainMemory recall, PersonProfile, `Task.personId`) but the task inspector shows none
   of it (`components/inspector/panels/task-inspector.tsx`: no person, notes or subtask field today). The steal is
   one sourced line under the task: what the brain last recorded about this person or mission. About 1 day.
3. **Subtasks as a checklist in task detail** (Google Tasks, Structured). The data exists
   (`Task.parentTaskId`, one level, `prisma/schema.prisma:418` after this job's schema edit); the detail view does
   not show or add children.
   About half a day, and it sits on the surface phase 2 is already building.

Everything else in section 3 stays a proposal for Nour.

## 2. What NOUR OS already has (prior-art grep, 2026-10-29, this worktree at 9d9797ba13)

| Candidate | Already in NOUR OS | Gap |
|---|---|---|
| Natural-language quick add | `lib/loops/quick-add-parser.ts:111` `parseQuickAdd`: "daily:", "promise @name ... by friday", "done:", bare "by <when>" | No live highlight of what was understood |
| Voice capture | `/api/ai/transcribe`; mic on quick add; realtime voice overlay in chat | One recording = one line; no split, no review list |
| One focus item a day | `/api/mit` (one Most Important Task per day, `brainMemory` key `daily_mit`, clears at midnight) and the Home verdict | No "pick today's few" list; may not need one (see 3.4) |
| Subtasks | `Task.parentTaskId` + `children`, indent renderer on Missions | Not in task detail |
| Assistant memory of people | BrainMemory + pgvector recall, PersonProfile, `/people`, Nick agent | Not surfaced on a task |
| Weekly patterns | `app/api/cron/weekly-review/route.ts`: wins, misses, patterns, recommended focus | No people section, no counts |
| Reflection prompts, journal | `/journal`, `components/journal/reflect-composer.tsx` (What / So what / Now what), `app/api/cron/journal-checkin/route.ts` (morning and evening prompts over Telegram) | Prompts are generic, not built from the entry or task |
| Inbox for undated tasks | `TaskStatus.INBOX` | none |
| Replan missed tasks | `snoozedUntil` + task-resurface cron, `driftRisk` | No one-tap "move the rest of today" |
| Energy per task | `Task.energyRequired` | No day-level energy curve |

## 3. Mechanisms, one by one

Grammar line: how it would look in the Command Deck genome (`docs/design/SURFACE-DNA.md` section 2 and
`apps/statenour/docs/design/ui-v3/PLAN.md`): one dominant thought per screen, ruled rows not cards, mono 11 to 12 px
metadata, 15 to 18 px body, inputs at 16 px or more, no stray uppercase, no em dash or emoji, motion under 300 ms,
gold only for identity (nav, mission rule, verdict emphasis), amber and rose only for state, in-DOM sheets instead
of `window.confirm`, 44 px targets. The ratchets in `tests/repo/ui-v3-ratchets.test.ts` must not rise.

### 3.1 Todoist Ramble: speak, watch tasks appear, correct by voice, confirm

Sources: https://www.todoist.com/help/todoist/todoist-and-ai/dictate-to-add-tasks-with-ramble-P1Raq7vVF ;
https://www.todoist.com/help/articles/capture-tasks-at-the-speed-of-thought-ramble-beta-nov-19-r6701hY0t ;
https://www.todoist.com/help/todoist/product-updates/turn-your-scattered-thoughts-into-clear-tasks-ramble-jan-21-2026-HhmP8ue8R ;
screenshot 8068250d (2026-10-29). All read 2026-10-29.

- Steps: tap the waveform icon inside Quick Add, talk freely, tasks appear in a **preview list while you talk**,
  say "Actually, I meant..." to edit one or "Remove that" / "Scratch that" to drop one, end with "That's all" or
  tap **Add tasks**. Nothing is saved before that tap.
- Defaults and states: listening state with a live waveform and the line "Say everything you need to get done"
  (screenshot); each preview row already carries parsed date, project, priority, duration, labels, description.
  Works only online. Free plan gets a monthly limit. There is no setting to turn it off.
- The trick: extraction and correction run on the whole running transcript, so the list stays editable by voice
  and the commit is one explicit action.
- Verdict: **adapt** (phase 2 pick 1). Keep record, split into rows, review, one Save. Skip live streaming
  (our transcribe route is one request after you stop) and voice-editing commands in v1: tap a row to edit,
  tap its remove control twice to drop it.
- Cost: about 1 day. Reuse `/api/ai/transcribe`, one model call that returns `{title, dueHint?, personHint?}[]`
  through the existing provider chain, then each row through `parseQuickAdd` and the existing create path
  (`lib/ai/tools/tasks.ts:167` `createTask` shape).
- Kill: on 20 of Nour's real dumps, fewer than 8 in 10 rows kept without an edit, or under 3 uses a week for two
  weeks. Either: fall back to one dictated line.
- Grammar: the capture row stays one 16 px field with a mic; recording turns the row into a single verdict line
  ("Listening, 0:12") with Stop; the preview is ruled rows with mono metadata (due, person) and a 44 px remove
  control (two taps, in DOM); one gold-ruled Save at the end. No modal stack, no waveform animation over 300 ms.

### 3.2 Jarvis (Himanshu Kapoor): talk not type, it remembers you

Sources: screenshot 72274adb (2026-10-29): App Store listing "Jarvis - Voice AI Assistant, An AI that remembers
you", 190 ratings; its screenshots read "Talk Not Type: no typing, no menus, just tap and start talking" and "It
Remembers You: Tell it once, people, projects, preferences, it carries forward every time". The App Store page
itself was not opened (NOT CHECKED beyond the screenshot).

- Steps seen: home is a voice orb with "Morning, Alex" and an ask for the morning brief; three tabs (Jarvis,
  Today, Memory). A question about a person ("what should we get Sam for her birthday?") gets an answer built from
  a stored fact ("Sam's been doing pottery all year") and **two or three tappable next-step chips** plus "A
  different idea".
- The trick: memory is shown back as the reason for the answer, and the answer ends in chips, not prose.
- Verdict: **adapt** into 3.1 (one tap to talk) and 3.3 (show the remembered fact as the reason). NOUR OS already
  has the memory and the morning brief (Home verdict); the Memory tab exists as `/brain`.
- Cost: none beyond 3.1 and 3.3. Kill: same as those.
- Grammar: chips become ruled action rows under the verdict, never a chip cloud.

### 3.3 Rosebud: a journal that knows you (long-term memory)

Sources: https://help.rosebud.app/ai-analysis/long-term-memory ; https://www.rosebud.app/ ; screenshot 7ccf7ce1
(2026-10-29). Read 2026-10-29.

- Steps: you write; the reply quotes an earlier entry ("Yesterday, you mentioned drifting apart from old friends.
  Could this be related to feeling lost today?", screenshot). Memory recalls by topic better than by date (their
  own help page says so). Paid tier only ("automatically enabled for Rosebud Bloom subscribers").
- The trick: the recalled fact is shown with its time anchor ("yesterday, you mentioned"), so you can judge it.
- Verdict: **adapt** (phase 2 pick 2): in task detail, one line under the title: the newest brain memory about
  the task's person (`personId`) or mission, with its date and source, and nothing when there is none. No paywall,
  no chat in the panel.
- Cost: about 1 day: one server read reusing the existing recall service, owner-gated, three states.
- Kill: on 20 tasks with a person, more than 1 in 5 lines wrong or irrelevant: remove the line.
- Grammar: mono 12 px metadata line ("Dania, 3 days ago, from chat"); body 15 px; loading shows a muted
  placeholder line; a failed read says "Couldn't load what Nick knows. Retry" and is never an empty space
  (empty-vs-error).

### 3.4 Microsoft To Do: My Day with suggestions

Sources: https://support.microsoft.com/en-us/todo/my-day-and-suggestions ;
https://support.microsoft.com/en-us/todo/plan-and-connect-with-microsoft-to-do ; screenshot 8068250d. Read 2026-10-29.

- Steps: My Day opens **empty every morning**; you type tasks into it or tap the light bulb for suggestions and
  tap + on each one you want. Unfinished items return to their list and show up in tomorrow's suggestions.
- The trick: a blank slate each day plus a suggestion pane, so planning is a choice, not an inherited pile.
- Verdict: **reject for now**. NOUR OS already answers "what now" with the Home verdict and the daily MIT
  (`/api/mit`, also blank each day); a third "today" list would split attention across surfaces. Reopen if Nour
  asks for more than one focus item a day.
- Cost if reopened: about 1 day, no migration (a dated `brainMemory` key like the MIT). Kill: unused for 7 days.
- Grammar: would be the MIT verdict plus up to three ruled rows, suggestions behind a closed disclosure.

### 3.5 Structured: one visual timeline for the day

Sources: https://help.structured.app/en/articles/380546 ; https://help.structured.app/en/articles/338178 ;
https://structured.app/blog/structuredfive (2025-04-10) ; App Store listing
https://apps.apple.com/us/app/structured-daily-planner/id1499198946 ; screenshots 271cf41c and ff8d1f32. Read 2026-10-29.

- Steps: the day is a vertical timeline framed by two default tasks ("Rise and Shine", "Wind Down"); each task is a
  colored capsule with an icon whose height is its duration; undated to-dos live in Inbox and are dragged into a
  free slot. Pro adds "Replan" (moves missed tasks) and Structured AI (natural-language day drafting, a scanner for
  paper planners), and needs a subscription.
- The trick: duration is drawn as height, so an overfull day is visible before it happens.
- Verdict: **reject now, proposal later**. Tasks have no start time or duration column today (only `effort` and
  `dueDate`), so this is a migration plus a new view, 2 to 3 days. Nour's shop runs first come, first served, so a
  rigid hour grid may fight his day; ask him first.
- Kill if built: unused on 5 of 7 days.
- Grammar: a single ruled time spine in mono, one gold rule at "now", capsules only for the current block.

### 3.6 Google Tasks and Structured: details and subtasks

Sources: https://support.google.com/tasks/answer/7675838?hl=en&co=GENIE.Platform%3DiOS ;
https://help.structured.app/en/articles/338050 ; screenshot ff8d1f32. Read 2026-10-29.

- Steps (Google Tasks, iPhone): tap a task, edit name, details, date, deadline, add subtasks, tap Back (saves on
  leave, no Save button). "Tasks with subtasks can't repeat." Untimed tasks notify at 9 AM.
- The trick: the detail view is the only editor, and it saves on leave.
- Verdict: **adopt** (phase 2 pick 3) for the checklist and save-on-leave; the notes field in PR 1 follows the same
  rule (autosave, visible "Saved" state). Keep our one-level rule (ADR-0017).
- Cost: about half a day on the existing `parentTaskId`. Kill: none needed; it is the house model already.
- Grammar: children as ruled rows with a 44 px check target; "Add a step" as one 16 px input at the end.

### 3.7 Todoist Quick Add: smart date highlighting

Sources: https://www.todoist.com/help/todoist/features/use-task-quick-add-in-todoist-va4Lhpzz (last updated
2026-09-01) ; https://www.todoist.com/help/todoist/features/introduction-to-recurring-dates-YUYVJJAV ; screenshot
8068250d. Read 2026-10-29.

- Steps: type "Review contract from Sarah by Friday 13:00 p2 +Alex"; recognized parts are **highlighted inline as
  you type**; tap a highlighted word to turn it back into plain text. "every" repeats from the due date, "every!"
  from completion.
- The trick: the parser shows its reading before you commit, and you can veto one token.
- Verdict: **adapt, proposal**: `parseQuickAdd` already parses; show its reading as a mono line under the field
  ("Promise to Dania, due Fri"). Half a day. Kill: the parser misreads more than 1 in 10 real captures.

### 3.8 Rosebud weekly report

Sources: https://help.rosebud.app/ai-analysis/weekly-report ; screenshot 7ccf7ce1. Read 2026-10-29.

- Contents: writing stats, emotional landscape (mood per day), key themes, **cast of characters** (people you wrote
  about), up to five insights; an "in-depth" report unlocks only past 1,500 words a week.
- Verdict: **adapt, proposal**: add a people section to `weekly-review` (who appears most in tasks, promises and
  journal that week) with counts. Reject the word-count unlock.
- Cost: half a day. Kill: Nour never opens the section in 3 weeks.

### 3.9 Apple Journal and stoic: prompts and privacy

Sources: https://support.apple.com/guide/iphone/write-in-your-journal-iph9824e83ce/ios ;
https://support.apple.com/guide/iphone/protect-your-journal-entries-iph9c59b1557/ios ;
https://www.macobserver.com/tips/round-ups/ios-27-journal-writing-prompts-how-to-use-turn-off/ (2026-09-16) ;
https://www.getstoic.com/ ; screenshots 08e16e01, 7ccf7ce1. Read 2026-10-29.

- Apple: suggestions built on device from photos, workouts, places; in iOS 27 writing prompts generated from what
  you are writing, **up to three per entry**, one switch turns them off; Face ID lock with an auto-lock delay.
- stoic: a morning preparation prompt and an evening reflection prompt; streaks and badges; premium tier.
- Verdict: **adapt, proposal**: when a task is marked done with a note or photo, offer one prompt built from them
  that saves to the existing `outcomeLesson` column. **Reject** streaks and badges (guilt loop; `Task.streakCount`
  for daily loops already exists and should not spread) and the separate lock (NOUR OS is behind its own sign-in;
  a WebAuthn lock is a later security question, not a feature).
- Cost: half a day. Kill: dismissed 9 of 10 times.

### 3.10 Images into tasks (Todoist, Structured AI scanner)

Sources: the Todoist Quick Add page above ("Quick Add can also turn text, images, or documents into multiple tasks
at once"); https://structured.app/blog/the-new-structured-ai (2024-06-18). Read 2026-10-29.

- Verdict: **proposal after PR 1 ships**: a task photo of a whiteboard or a parts list becomes subtask rows through
  the same review list as 3.1. Chat already accepts images. About 1 day. Kill: same as 3.1.

## 4. Top ten, ranked

| # | Mechanism (source) | NOUR OS today | Verdict | Cost | Kill criterion | Command Deck shape |
|---|---|---|---|---|---|---|
| 1 | Voice dump to several tasks with a review list (Todoist Ramble, Jarvis) | transcribe + single-line mic | adapt, phase 2 | 1 day | < 8 in 10 rows kept unedited on 20 dumps, or < 3 uses a week | one field, listening verdict line, ruled preview rows, one Save |
| 2 | Recall line on a task from memory (Rosebud, Jarvis) | memory exists, not on tasks | adapt, phase 2 | 1 day | > 1 in 5 lines wrong on 20 tasks | mono 12 px line under the title, three states |
| 3 | Subtask checklist, save on leave (Google Tasks, Structured) | `parentTaskId`, not in detail | adopt, phase 2 | 0.5 day | none (house model) | ruled rows, 44 px checks, one 16 px add field |
| 4 | Live reading of quick add (Todoist) | `parseQuickAdd` | adapt, proposal | 0.5 day | > 1 in 10 misreads | mono line under the field |
| 5 | People in the weekly review (Rosebud) | weekly-review, no people | adapt, proposal | 0.5 day | unopened 3 weeks | ruled rows with counts |
| 6 | Prompt at completion from the task's note or photo (Apple Journal) | `outcomeLesson` column | adapt, proposal | 0.5 day | dismissed 9 of 10 | one line, one 16 px field |
| 7 | Photo of a list into subtasks (Todoist, Structured AI) | chat accepts images | proposal | 1 day | as #1 | reuses #1's review rows |
| 8 | Day timeline with duration as height (Structured) | no start or duration columns | reject now, ask Nour | 2 to 3 days + migration | unused 5 of 7 days | single mono time spine, gold "now" rule |
| 9 | My Day blank slate with suggestions (Microsoft To Do) | MIT + Home verdict | reject now | 1 day | unused 7 days | MIT verdict + three rows |
| 10 | Streaks, badges, word-count unlocks, paywalled memory (stoic, Todoist Karma, Rosebud) | `streakCount` on daily loops | reject | 0 | n/a | not built |

## 5. Bad parts we do not copy

- Paywalls on the core loop: Structured AI and Replan need Pro; Rosebud memory needs Bloom; Ramble has a free-plan
  monthly limit. NOUR OS has one user and no tiers.
- Guilt mechanics: streaks, badges, karma, an in-depth report unlocked by writing 1,500 words.
- No off switch: Ramble "currently no option to turn off". Every new prompt or suggestion here gets a Less control.
- Ads: four of the circled listings were App Store ads (Todoist, In Ear Voice, Rosebud, My Diary). Nothing to copy;
  noted so nobody mistakes ranking for quality.
- Silent sharing: Apple Journal suggestions read photos, places and workouts. Our recall reads only what NOUR OS
  already stores, and says where each line came from.

## 6. Not checked

- The Jarvis, In Ear Voice, Zinnia and My Diary App Store pages themselves (screenshots only).
- Whether Nour's iPhone Safari encodes WebP from a canvas (phase 2 falls back to JPEG either way).
- Real usage numbers for any NOUR OS surface named above.
