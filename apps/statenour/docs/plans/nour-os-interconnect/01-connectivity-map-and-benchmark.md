# NOUR OS interconnect: connectivity map and benchmark (01)

Job 2026-11-02-nour-os-interconnect, research lane. Read-only. Code read at origin/main `69c4bc7a94`. Written 2026-11-02.
SHOP DATA: none read (NOUR OS, the personal app).

## 1. Answer first

Nour's claim holds, with one exception. Goals, missions and Nick mostly do not talk: Nick never sees a goal id, the
Missions page never shows a goal, no mission is linked to a goal, and a finished task moves a dollar goal by 1. The
journal is the exception: it already links each entry to a goal or mission with AI and hands that goal to the tasks
it creates. People and the journal share no key at all.

The fix is mostly wiring, not new systems. Ranked gaps are in section 3. The one mechanism that would make every
surface share state (section 5) is a read-side "related activity" query over the event tables that already exist,
plus one missing link (person ids on journal entries).

Labels: FACT = read in code at the base SHA (file:line given). STRONG INFERENCE = follows from facts, not run.
CLAIM = someone said it, not checked. UNKNOWN = not measured. Production counts come from the manager's read-only
prod read (2026-11-02 21:45Z), quoted in the brief; this lane ran no prod read.

Benchmarked against: Linear initiatives + updates (https://linear.app/docs/initiatives) · adopted: health from the
latest update, agent-drafted update from changes since the last one, goal-to-task through the project ·
Sunsama weekly objectives + weekly review (https://help.sunsama.com/docs/weekly-objectives) · adopted: objective
chip on task cards, one-key align, review that ends in a journal entry · Tana supertags
(https://outliner.tana.inc/learn/features/supertags) · adopted: a search built into each entity's page, typed
references instead of free-text tags · rejected: Tana's one-outliner data model (a rewrite), Sunsama time tracking
(no time data), Linear Slack routing (no team). Primary pages read directly with WebFetch on 2026-11-02 (not
Perplexity: this lane cannot drive Chrome; the query for the manager is in section 7).

## 2. The 7 x 7 map

Rows are the surface that acts; columns are the surface it reads (R) or writes (W). "none" cells name the search
that came back empty. Paths are under `apps/statenour/`. In-flight PR A (`statenour/goals-plan-link`) is cited, not
redone.

Surfaces: **Goals** (LifeGoal, GoalEvent, /stats Goals tab, `components/goals/goal-board.tsx`) · **Missions**
(Mission, Task, /missions) · **Nick** (chat route, prompt, tools) · **Brain** (BrainMemory, wisdom, insights, /brain,
brain crons) · **Journal** (BrainDump, Reflection, SituationLog, DecisionReplay, /journal) · **People**
(PersonProfile, RelationshipLedger, /people) · **Home** (`/`, `components/home/home-console.tsx`).

| acts \ on | Goals | Missions | Nick | Brain | Journal | People | Home |
|---|---|---|---|---|---|---|---|
| **Goals** | self: create `lib/services/goals.ts:313`, update `:421`, GoalEvent log | R: open linked-task count `lib/services/goals-snapshot.ts:125-135`; next step via Task.goalId `goals.ts:97`; active missions listed with no goal filter `goals-snapshot.ts:140`. W: "Plan it" creates a mission with no `lifeGoalId` `components/actions/milestones-flow.tsx:145` (PR A in flight) | R: none (goal board has no Nick read). W: none; the Goals tab mounts `NickSidePane page="goals"` `app/(mastery)/stats/page.tsx:274`, whose page data sends titles, no ids `lib/ai/page-data.ts:330` | R: prune candidates `goals-snapshot.ts:195`. W: goal-pruner writes `goal_prune_candidate` `lib/inngest/functions/goal-pruner.ts:106` | R: one journal step per goal from BrainDump.goalId `goals.ts:246`. W: none, `grep brainDump\|reflection` in goals.ts writes empty | R: people on a goal via Task.personId `goals.ts:112`, `:220`. W: none | none: Goals never reads Home (Home is read-only of others) |
| **Missions** | R: none on the page: `grep -i goal lib/missions/deck.ts lib/services/missions.ts` empty; `goalLineage` not passed `app/(mastery)/missions/page.tsx:204-213`, so `lib/tasks/hidden-risk.ts:192` never fires. W: task done adds +1 to `currentValue`, unit-blind `lib/services/tasks.ts:1605`, `:1636` | self: Mission, Task; FK Mission.lifeGoalId `prisma/schema.prisma:271` has 0 writers (`git grep lifeGoalId` finds readers only) | R/W: none from the page; `NickSidePane` mounted `missions/page.tsx:315` | W: goal-lift marker `tasks.ts:1614`. R: none, `grep brainMemory lib/missions/deck.ts` empty | none: `grep -i "journal\|brainDump" lib/missions/deck.ts lib/services/missions.ts` empty | R: none shown; Task.personId exists `schema.prisma:385` but `grep person components/missions` finds only a placeholder `components/missions/task-edit-sheet.tsx:483`. W: none from Missions UI (task editor not checked) | none |
| **Nick** | R: "Active Goals" prompt block, no ids `lib/ai/prompt/v2/renderer.ts:436-451` from `lib/ai/context/command-center-state.ts:479`; `analyzeGoals` returns titles only `lib/ai/tools/brain.ts:671`, `lib/brain/analyzers/goal.ts:47`. W: `archiveGoal` `lib/ai/tools/goals.ts:19`; `createTask.goalId` takes an id only `lib/ai/tools/tasks.ts:297`; no create or progress tool (`grep setLifeGoal\|logGoalProgress lib/ai` hits one comment, `tasks.ts:560`) | R: `getMissions`, `getMissionDetail`, `getTasks` `lib/ai/tools/catalog.ts:94,100,101`; "Active Missions" block `renderer.ts:423`. W: `createTask`, `createMissionPlan` (no goal field on the mission) `lib/ai/tools/missions.ts:232-249`, `addTasksToProject` `missions.ts:184` | self: ChatConversation; cron sets `chat_conversations.mission_id` by embedding `lib/db/conversation-mission-linker.ts:286` | R: contextual recall + wisdom slots `lib/brain/contextual-recall.ts:278`; `searchMemories` `brain.ts:168`. W: `pinMemory` `brain.ts:486`; knowledge extraction after each turn `lib/services/chat/deferred-background-work.ts:196` | R: "Recent Thinking" block `renderer.ts:463`; `getRecentReflections` `brain.ts:815`. W: `journalDecision` `tasks.ts:830`, `logSituation` `tasks.ts:913` | R: `getRelationshipPicks` `tasks.ts:96`; 30 people in recall `contextual-recall.ts:2367`. W: person actions incl. logInteraction `lib/ai/agent-actions/person-actions.ts:14-19` | R/W: none (Home reads Nick, not the reverse) |
| **Brain** | R: brain graph edge mission to goal `lib/brain/brain-graph.ts:723` (never fires: 0 links). W: prune candidates (see Goals row). /brain page: no goal read, `grep -i "lifeGoal\|goalId" components/brain/{memory,discover,knowledge-review,health}-tab.tsx` empty | R: brain graph reads missions `brain-graph.ts:723`. W: chat-to-mission review rows; approve only updates the BrainMemory row `lib/services/link-review.ts:99-143` | W: recall and wisdom text into every chat prompt `contextual-recall.ts:278`. R: none; conversation digests are read by Home `lib/trpc/routers/operator.ts:1490`, not by a brain view | self: BrainMemory, wisdom, contradictions | R/W: journal-brain grounds each entry and writes goalId/missionId back `lib/brain/journal-brain.ts:174-198`; takes stored as `journal_brain_take` | R: people list for recall `contextual-recall.ts:2367`. W: people-intelligence updates PersonProfile (cron) `app/api/cron/intelligence/route.ts:35-38` | none |
| **Journal** | R: active goals for AI linking `journal-brain.ts:229`; goal titles on feed rows `lib/services/journal-feed.ts:372-378`. W: BrainDump.goalId `journal-brain.ts:174`; its own tasks get the goal `lib/brain/journal-task-link.ts:42-46`; confirm credits stat XP, not goal value `lib/trpc/routers/journal.ts:722-727` | R: active missions for linking `journal-brain.ts:234`. W: Inbox tasks from entries `lib/brain/journal-ingest.ts:448-466`; promote next action `journal.ts:796` | none: the journal page has no chat entry; `grep -n "trpc\.chat\|NickSidePane" app/(mastery)/journal/page.tsx` empty | R: insights preview `journal.ts:584-595`. W: takes + linked memory ids (journal-brain) | self: 4 silos merged by `buildJournalFeed` `journal-feed.ts` | none: people only as free-text `linkedTopics` `journal-ingest.ts:298`, `:322`; no personId column on any journal table (schema FK census, section 6) | none |
| **People** | R: "topic x goal overlap" card `components/power-atlas/TopicGoalOverlapCard.tsx:6-7` reads metadata whose cron was deleted in `f87fb7e628` (dead). `lib/brain/people-intelligence.ts:12,45` claims "people relevant to goals"; no goal query in the file. W: none | R/W: promise tasks; link sets Task.personId `lib/services/people/link-promise.ts:30` | none: Nick reads People, not the reverse | R: maxim for a pick from the static pool `lib/services/people/maxim-for-pick.ts:10-27` (files, not BrainMemory). W: none, `grep brainMemory lib/services/people` empty | none: `grep -i "journal\|brainDump" lib/services/people app/api/people/route.ts` empty | self: PersonProfile, RelationshipLedger, one contact writer `record-interaction.ts:154` | none |
| **Home** | R: goals card `components/home/home-cards.tsx:134`; LATER/WEEK horizon goals `lib/home/operator-brief.ts:334-353`. W: none | R: DOING/INBOX/due tasks `operator-brief.ts:279`, `:311`, `:320`; no Mission row read, `grep prisma.mission lib/home` empty. W: recommendation decisions, follow-up to task `operator.ts:1382` | R: "Nick remembers" from conversation digests `operator.ts:1487-1495` (a failed read returns `[]`, renders as "nothing"). W: Nick command line posts to chat `components/home/nick-command-line.tsx:115` | R: open contradictions `operator-brief.ts:193`; memory-write count `:969`; maxim skips `lib/services/home-maxim.ts:43-47`. W: Keep pins a maxim, Skip writes a 30-day row (`home-maxim.ts` header) | none: only a calendar slot links to /journal `operator-brief.ts:820`; `grep -i "brainDump\|reflection" lib/home` empty | R: people totals `home-cards.tsx:131`; love-map question `components/relationships/love-map-line.tsx:37`. W: answer appended to notes `love-map-line.tsx:40`, `lib/trpc/routers/task/power-atlas.ts:480` | self: home signal `operator.ts:1445` |

Cell count: 49 (7 rows x 7 columns, every cell filled; 7 diagonal "self" cells).

## 3. Gaps, ranked by what Nour feels first

1. **"Plan it" on a goal fails and leaves an orphan mission.** FACT (brief, manager prod read): 3 of 3 plan calls
   today returned `provider_emergency` after 53-58 s; the mission is created without `lifeGoalId`. **In flight: PR A.**
2. **Nick cannot attach work to a goal.** FACT: every goal Nick sees has no id (prompt `renderer.ts:436-451`, page
   data `page-data.ts:330`, `analyzeGoals` `analyzers/goal.ts:47`), and `createTask.goalId` takes an id only
   (`tasks.ts:297`). Nick has no create-goal or log-progress tool. STRONG INFERENCE: tasks Nick creates almost never
   carry a goal, which is what "Nick doesn't talk to goals" feels like. UNKNOWN: share of Nick-created tasks with a
   goalId (needs a prod read: tasks created by chat, goalId not null, over all tasks created by chat).
3. **The goal number is wrong for metric goals.** FACT: completing a linked task adds 1 to `currentValue`
   whatever the unit (`tasks.ts:1605`, `:1636`); the schema documents units like `$` and `lbs`
   (`schema.prisma` LifeGoal `unit`). FACT (brief): all 3 active goals are `kind=metric`. STRONG INFERENCE: a $15,000
   goal moves $1 per task done. Fix: lift only `kind` milestone/count goals; metric goals take a check-in value.
4. **Missions never show the goal.** FACT: no goal on mission or task cards, 0 of 13 missions linked (brief), and the
   goal-pace risk bump is dead because the page drops `goalLineage` (`missions/page.tsx:204-213`,
   `hidden-risk.ts:192`). Nour opens Missions and cannot see why any task matters.
5. **People and Journal share no key.** FACT: no personId column on BrainDump, Reflection, SituationLog or
   DecisionReplay (section 6); people mentions are free-text `linkedTopics`. The People page reads nothing from the
   journal, and its goal-overlap card is dead (writer deleted `f87fb7e628`). Writing "talked to Dania about the move"
   in the journal does not touch Dania's page or her last-contact date.
6. **Home skips missions and the journal.** FACT: no Mission or journal read in `lib/home` (greps in the map). The
   "Nick remembers" row hides a failed read as an empty list (`operator.ts:1495`, `.catch((): any[] => [])`), an
   empty-vs-error instance.
7. **Brain is keyed by chat topic, not by goals or people.** FACT: `contextual-recall.ts` has no LifeGoal query; the
   /brain tabs read no goal or person. Wisdom shows up when the chat topic matches, not when a goal is behind.
8. **Chat-to-mission links are written and never read.** FACT: cron `conversation-mission-link`
   (`config/crons.ts:386`) sets `chat_conversations.mission_id`; `git grep` for a reader of that column in
   `components/missions` and the chat routers is empty. Approving a review row only updates the BrainMemory row.

What already works (keep, do not rebuild): journal grounding to goal/mission with confidence and confirm
(`journal-brain.ts`), journal tasks inheriting the goal (`journal-task-link.ts`), people-on-goal from task owners
(`goals.ts:112`), goal pace and staleness on the goal card, Nick's people and journal reads, one contact writer for
people (`record-interaction.ts`).

## 4. Benchmark: three systems, mechanisms to steal

Pages read 2026-11-02 with WebFetch (primary docs). Quotes are under 15 words.

### 4.1 Linear: initiatives, projects, updates

URLs: https://linear.app/docs/initiatives · https://linear.app/docs/initiative-and-project-updates (read 2026-11-02).

| # | Mechanism (data flow · trick · UI · failure it avoids) | Call | Kill criterion |
|---|---|---|---|
| L1 | Goal reaches work through the project: issues do not attach to initiatives; the initiative graph is "the rate of completed issues within a single project". Trick: one link per level, inherited downward. Avoids per-task linking that nobody keeps up. | **ADAPT**: a task inherits the goal from `Mission.lifeGoalId` when its own `goalId` is empty (read-time, no backfill); `Task.goalId` stays as the override. | Drop if, 14 days after PR A, fewer than 3 of the live missions carry a goal (missions are not being linked, so there is nothing to inherit). |
| L2 | Health comes from the latest update: on track, at risk, off track, and gray for "no current update". Trick: staleness is a visible state, not a silent green. | **ADOPT** on the goal card: health = latest check-in; gray when none in the goal's cadence. Matches `empty-vs-error`. | Drop if Nour leaves every goal gray for 3 weeks (he is not checking in, so the signal is noise). |
| L3 | Reminders to the owner on a cadence, then nudges "1 working day later and then 2". | **ADAPT**: one Home row "goal check-in due" for the most overdue goal; no Telegram push in v1. | Drop if dismissed 3 weeks running. |
| L4 | "Write with Agent": the agent "reviews changes since the last update" and drafts it. Trick: the human edits, the machine gathers. | **ADOPT**: Nick drafts a goal check-in from GoalEvent, linked TaskEvents and goal-linked journal entries since the last check-in. This is the mechanism that makes goals, missions, journal and Nick talk. | Drop if Nour rewrites more than half of the drafts after 10 check-ins. |
| L5 | Progress details appear only when progress "change[d] by more than 2%". | **ADOPT** as a rule for the draft: omit the number line when nothing moved. | none needed (display rule). |

Rejected: Slack channel routing, per-project reminder overrides (one operator, few goals).

### 4.2 Sunsama: weekly objectives and the weekly review

URLs: https://help.sunsama.com/docs/weekly-objectives · https://help.sunsama.com/docs/weekly-review (read 2026-11-02).

| # | Mechanism | Call | Kill criterion |
|---|---|---|---|
| S1 | One-key align: press `R` or "Align with objective" on any task; aligned tasks show a purple target. Trick: linking costs one tap at the moment of doing. | **ADOPT**: an "align to goal" action on Missions task cards plus a goal chip on aligned cards (closes gap 4). | Drop the chip if Nour hides it or reports clutter. |
| S2 | Drag an objective onto a day and it creates a task "automatically aligned". | **ADAPT**: goal card "do one step today" creates a linked task for today (reuses `task.spawnTasks` with goalId, `lib/trpc/routers/task.ts:1075`). | Drop if unused for 3 weeks. |
| S3 | Weekly review in three steps: objectives, body of work, then a journal reflection; "Automate" pulls aligned tasks into it. | **ADAPT**: a weekly review that shows each goal's done tasks and linked journal entries, then saves the reflection as a journal entry already grounded to those goals. | Drop if not completed 2 weeks in a row. |
| S4 | "Extend one week": unfinished objectives carry over only by an explicit act. | **ADAPT** for WEEK-horizon goals: extend or close at review, instead of silent staleness. | Drop if Nour extends every goal every week (the horizon is wrong, not the mechanism). |

Rejected: time spent per objective (NOUR OS has no time tracking and adding it is a new habit, not wiring).

### 4.3 Tana: supertags and search nodes

URL: https://outliner.tana.inc/learn/features/supertags (read 2026-11-02; redirect from tana.inc/docs/supertags).

| # | Mechanism | Call | Kill criterion |
|---|---|---|---|
| T1 | A supertag's page "creates a search looking for all nodes with this supertag". A search can live inside a type: "a Person looks up related Meetings". Trick: the related view is a saved query, never a copy. | **ADAPT**: every goal, mission and person page gets a "Related" section computed by one query over existing tables (section 5). | Drop if the section is empty for most entities after 14 days (the links are missing, fix writers first). |
| T2 | Fields hold lists of node references, not strings. | **ADOPT**: journal people mentions become person ids through the existing fuzzy resolver Nick uses (`log-from-text.ts` header), not free-text `linkedTopics`. Needs a migration (`statenour-migration` skill). | Drop if resolver precision on 20 hand-checked entries is under 80%. |
| T3 | A Day type is the journal entry; Today shows related tasks and meetings. | **DEFER**: a journal day view with that day's done tasks and people contacts, after T1 lands. | n/a until built. |

Rejected: Tana's single outliner graph where everything is a node (a rewrite of every table). Backlink behaviour is not
described on the page read (UNKNOWN), so nothing here depends on it.

## 5. The 10x option

Build one read, not a new store: `relatedActivity({ goalId | missionId | personId }, since)` that unions the event
rows NOUR OS already writes, keyed by the ids they already carry: GoalEvent (goalId), TaskEvent (goalId, taskId),
BrainDump, Reflection, SituationLog and DecisionReplay (goalId, missionId), RelationshipLedger (personId), and Task
(goalId, missionId, personId). Three consumers read it: a "Since last check-in" section on the goal card and person
page, a Nick read tool (`getRelated`, pulled on demand, so no new push block in the prompt), and the Linear-style
check-in draft (L4). Two writers close the holes it exposes: `Mission.lifeGoalId` (PR A) and person ids on journal
entries (T2). Goal ids go into Nick's goal lines so his existing `createTask.goalId` works.

Prior art checked: `AuditEvent` (generic, actor/eventType, no entity key, `schema.prisma` model AuditEvent) and
`EntityAudit` (field-level provenance, 1 writer in `lib` + `app`) are not the spine; the per-entity event tables are.
No new table, no second goals table, no second planner.

Cost: STRONG INFERENCE, one read-layer PR (about 1-2 days: query, tool, two UI sections, tests) plus one migration PR
for journal person ids (about 1 day, hand-applied per `DB-MIGRATION-POLICY.md`).
Kill criterion: drop the spine if, 14 days after it ships, the goal card's related section is empty for 2 of the 3
active goals (the links are not being written, so fix writers instead), or Nour edits more than half of the drafted
check-ins.

## 6. Evidence appendix

Schema FK census (FACT, `awk` over `prisma/schema.prisma` for goalId, lifeGoalId, personId, missionId fields):
Mission.lifeGoalId :271 · Task.missionId :333, personId :385, goalId :398 · TaskEvent.goalId :506 ·
ChatConversation.missionId :1135 · BrainDump.goalId/missionId :1330-1331 · Reflection.goalId/missionId :2127-2128 ·
RelationshipLedger.personId :2385 · LifeGoal.parentGoalId :2516 · GoalEvent.goalId :2587 ·
DecisionReplay.goalId/missionId :2705-2706 · SituationLog.goalId/missionId :3027-3028 · EvidenceClaim.goalId :3885 ·
TasteJudgment.goalId :3916. No journal table and no BrainMemory column carries personId.

Old matrix reuse: `docs/project/STATENOUR-CONNECTIVITY-MATRIX.md` (2026-06-09) rows were used as leads only. Two of its
claims no longer hold at this SHA: chat tools `setLifeGoal` and `logGoalProgress` (matrix GOALS rows) are not in
`lib/ai/tools/catalog.ts`, and its "Plan it" row is superseded by PR A.

Prior benchmark not repeated: `docs/research/2026-10-29-task-app-benchmark.md` covered Todoist, Rosebud, Microsoft To
Do, Structured, Google Tasks and Apple Journal (capture and journaling). This doc covers goal-to-execution linking.

## 7. Not checked

- Production counts beyond the brief's (Nick-created tasks with goalId; journal entries per linkStatus; whether old
  `topicGoalOverlap` metadata still sits on any PersonProfile).
- The task edit sheet's person field and the Missions task editor's goal picker (UI not opened).
- Whether `NickSidePane` sends task ids on row tap (`components/mastery/nick-side-pane.tsx:22` says so; not traced).
- Live behaviour of any surface (no browser session against bdnick.info).
- Perplexity query for the manager, if a wider benchmark is wanted: "Best personal goal-to-execution systems 2025-2026:
  how do Linear initiatives, Sunsama objectives, Tana supertags, Sunsama weekly review, Reclaim habits and personal
  CRMs (Clay, Dex) link goals to tasks, journal entries and people? Mechanisms, data model, failure modes, with
  primary sources."
