# Project Management Dashboard Spec

Date: 2026-07-09
Owner surface: `apps/statenour`
Target surface: NOUR OS project / mission execution layer
Status: implementation-ready design spec

## 1. Executive intent

Build a project management dashboard that gives the operator and future collaborators one command surface for project progress, tasks, deadlines, ownership, blockers, and recent movement.

The key decision: do **not** build this as a disconnected project-management app. The existing system already has the hard primitives: `Mission` as project/campaign, `Task` as executable unit, `TaskEvent` as activity stream, `MissionLink` as dependency graph, due dates, statuses, subtasks, phase names, scoring, and polling-backed data refresh. The dashboard should be a higher-order operating view over those primitives.

This keeps the system scalable, avoids a second truth source, and prevents the common failure mode: beautiful dashboard, dead data.

## 2. Product thesis

A project dashboard is only useful if it answers four questions instantly:

1. What matters most right now?
2. What is moving, stuck, late, or ownerless?
3. Who owns the next action?
4. What changed since the last time I looked?

Everything else is decoration. The dashboard should bias toward execution pressure, not passive reporting.

## 3. Recommended route and placement

Primary route:

```txt
/project-dashboard
```

Alternative if navigation bloat is a concern:

```txt
/missions?view=dashboard
```

Recommendation: start with `/project-dashboard` as a separate page that reuses the same data hooks and components as `/missions`. Later, if it becomes the superior view, fold it back into `/missions` as a mode switch.

## 4. Existing repo fit

The current app stack supports this feature directly:

- Next.js App Router + React client components.
- Prisma/Postgres backing existing mission/task data.
- tRPC task router with list, mission, event, create, check, start, delete, mission-link, and task update paths.
- Existing `/missions` page already polls tasks and missions and uses extracted hooks.
- Existing UI conventions require new domain UI under `components/<domain>/` and shared primitives under `components/ui/`.

## 5. Core dashboard layout

Use a mobile-first command dashboard with a dense desktop expansion.

### 5.1 Top command strip

Purpose: one-screen executive read.

Cards:

- Active projects
- Open tasks
- Due this week
- Overdue tasks
- Blocked / waiting tasks
- Completion velocity, last 7 days
- Risk index

Risk index formula v1:

```txt
risk = overdueTasks * 3
     + waitingTasks * 2
     + staleActiveTasks * 2
     + highPriorityNoDueDate * 1
     + projectsWithNoReadyTask * 3
```

This does not need AI. Make it deterministic first.

### 5.2 Progress visualization

Show each active mission/project as a row or card with:

- Project title
- Domain
- Deadline
- Progress bar
- Done / open / waiting task counts
- Current phase from `Task.phaseName`
- Next action
- Blocker flag
- Last movement timestamp

Progress v1:

```txt
progress = doneTasks / nonArchivedTasks
```

Progress v2:

Weighted progress:

```txt
weightedProgress = sum(doneTask.roiScore) / sum(allNonArchivedTask.roiScore)
```

Use v1 first. Weighted progress can create false precision if scores are stale.

### 5.3 Task command board

A compact board grouped by status:

- READY
- DOING
- WAITING
- DONE recently
- INBOX / needs triage

Each task card should show:

- Title
- Mission/project
- Assignee
- Due date
- Effort band
- Energy required
- ROI score
- Friction score
- Waiting-on field
- Start / complete / edit actions

Do not copy Trello. This is not a drag-to-feel-productive board. It is a decision board.

### 5.4 Deadline radar

Dedicated deadline module:

- Today
- Next 7 days
- Later
- Overdue
- No deadline but high priority

Sort rule:

```txt
overdue first -> due date asc -> roiScore desc -> frictionScore desc
```

High-priority task with no due date should be treated as an ambiguity bug, not ignored.

### 5.5 Collaboration lane

V1 collaboration should be honest and simple:

- Assignee
- Waiting on
- Last update
- Next owner action
- Comment/note field if supported by existing update path

If team member records do not exist yet, use a lightweight assignment string first, then migrate to structured `PersonProfile` or `TeamMember` relation later.

Recommended field progression:

Phase A:

```ts
assigneeName?: string
```

Phase B:

```prisma
assigneeId String?
assignee PersonProfile? @relation(...)
```

Phase C:

```prisma
model TaskComment
model ProjectParticipant
```

Do not build comments before task ownership is clean. Ownership is the collaboration bottleneck.

### 5.6 Activity stream / real-time updates

Use `TaskEvent` as the source. Activity stream should show:

- Task started
- Task completed
- Task nudged
- Task snoozed
- Priority changed
- Task linked/unlinked
- Stale flagged
- Blocker changed

V1 real-time strategy:

- Reuse React Query polling already established in `/missions`.
- Tasks refetch every 15 seconds.
- Missions refetch every 30 seconds.
- Events can refetch every 30 seconds when the dashboard is visible.

V2 real-time strategy:

- Add SSE endpoint: `/api/project-dashboard/events`.
- Stream newly created `TaskEvent` rows after cursor.
- Client merges optimistic updates with query invalidation.

Do not jump to WebSockets unless multi-user live editing becomes real. SSE is enough for activity and status changes.

## 6. Data contract

Create one service function first:

```ts
buildProjectDashboardState(): Promise<ProjectDashboardState>
```

Return a flat, UI-safe shape. Avoid leaking deep Prisma JSON types through tRPC.

```ts
export interface ProjectDashboardState {
  generatedAt: string;
  summary: {
    activeProjects: number;
    openTasks: number;
    overdueTasks: number;
    dueThisWeek: number;
    waitingTasks: number;
    completedLast7Days: number;
    riskIndex: number;
  };
  projects: ProjectDashboardProject[];
  taskBoard: {
    ready: ProjectDashboardTask[];
    doing: ProjectDashboardTask[];
    waiting: ProjectDashboardTask[];
    inbox: ProjectDashboardTask[];
    recentlyDone: ProjectDashboardTask[];
  };
  deadlineRadar: {
    overdue: ProjectDashboardTask[];
    today: ProjectDashboardTask[];
    next7Days: ProjectDashboardTask[];
    later: ProjectDashboardTask[];
    highPriorityNoDeadline: ProjectDashboardTask[];
  };
  activity: ProjectDashboardEvent[];
}
```

Project row:

```ts
export interface ProjectDashboardProject {
  id: string;
  title: string;
  domain: string;
  status: string;
  priority: number;
  roiScore: number;
  deadline: string | null;
  progress: number;
  doneTaskCount: number;
  openTaskCount: number;
  waitingTaskCount: number;
  overdueTaskCount: number;
  currentPhase: string | null;
  nextTask: ProjectDashboardTask | null;
  lastMovementAt: string | null;
  riskFlags: string[];
}
```

Task row:

```ts
export interface ProjectDashboardTask {
  id: string;
  title: string;
  missionId: string;
  missionTitle: string;
  status: string;
  dueDate: string | null;
  phaseName: string | null;
  effort: string;
  energyRequired: string;
  context: string;
  roiScore: number;
  frictionScore: number;
  waitingOn: string | null;
  assigneeName: string | null;
  startedAt: string | null;
  lastTouchedAt: string | null;
}
```

Event row:

```ts
export interface ProjectDashboardEvent {
  id: string;
  taskId: string;
  taskTitle: string;
  missionId: string;
  missionTitle: string;
  kind: string;
  source: string | null;
  createdAt: string;
  payload: unknown;
}
```

## 7. API design

Add tRPC endpoint:

```ts
projectDashboard.state
```

or, if keeping inside current task router:

```ts
task.projectDashboard
```

Recommendation: create a new `projectDashboardRouter` only if this grows beyond one read endpoint. For first slice, `task.projectDashboard` is acceptable because it reuses task/mission/event data.

Mutation strategy:

- Start task: existing `task.start`
- Complete task: existing `task.check`
- Update task fields: existing task update path
- Create task: existing `task.create`
- Create mission/project: existing `task.createMission`
- Link dependencies: existing mission-link procedures

Do not create duplicate mutations.

## 8. UI components

Proposed files:

```txt
apps/statenour/app/(mastery)/project-dashboard/page.tsx
apps/statenour/components/project-dashboard/project-dashboard-shell.tsx
apps/statenour/components/project-dashboard/project-summary-strip.tsx
apps/statenour/components/project-dashboard/project-progress-list.tsx
apps/statenour/components/project-dashboard/task-command-board.tsx
apps/statenour/components/project-dashboard/deadline-radar.tsx
apps/statenour/components/project-dashboard/collaboration-lane.tsx
apps/statenour/components/project-dashboard/activity-stream.tsx
apps/statenour/lib/services/project-dashboard.ts
apps/statenour/lib/trpc/routers/project-dashboard.ts
apps/statenour/tests/project-dashboard/project-dashboard-state.test.ts
```

If the first implementation needs to stay smaller, ship only:

```txt
apps/statenour/app/(mastery)/project-dashboard/page.tsx
apps/statenour/components/project-dashboard/project-dashboard-shell.tsx
apps/statenour/lib/services/project-dashboard.ts
apps/statenour/tests/project-dashboard/project-dashboard-state.test.ts
```

One component can contain the submodules until usage proves stable. Avoid premature file explosion.

## 9. Visual design standard

Follow current statenour UI rules:

- Use `GlassCard` for card surfaces.
- Use token bridge utilities, not new raw arbitrary color systems.
- Keep page bottom padding compatible with fixed mobile chrome.
- Use small, dense, high-signal surfaces.
- Default to mobile vertical stack; desktop can switch to two-column dashboard.

Recommended visual hierarchy:

1. Risk / deadlines
2. Current project progress
3. Task board
4. Collaboration / activity

Do not bury deadlines below pretty charts.

## 10. Implementation slices

### Slice 1 — Read-only dashboard state

Goal: working dashboard with no new schema.

- Build `buildProjectDashboardState()`.
- Add tRPC read endpoint.
- Add `/project-dashboard` route.
- Show summary, project progress, deadline radar, and task board.
- Use polling only.
- Add tests for summary counts, overdue grouping, progress calculation, and risk flags.

Acceptance:

- Active missions render as projects.
- Tasks group by status.
- Deadlines group correctly.
- Dashboard refetches without page reload.
- No duplicate business logic in UI.

### Slice 2 — Execution actions

Goal: dashboard can drive work, not just display it.

- Add start / complete actions using existing mutations.
- Invalidate dashboard state after mutation.
- Add optimistic UI where safe.
- Surface errors through toast.

Acceptance:

- Start transitions READY/WAITING task to DOING where service allows.
- Complete moves task to DONE and progress updates.
- No action bypasses existing TaskEvent emission.

### Slice 3 — Collaboration ownership

Goal: basic ownership and accountability.

- Add `assigneeName` or structured `assigneeId` depending on available person/team model.
- Expose ownerless tasks.
- Add filter: ownerless / mine / waiting on external.
- Add collaboration lane.

Acceptance:

- Every open task can show owner status.
- Ownerless high-priority tasks are visible as risk.
- Waiting tasks show `waitingOn` prominently.

### Slice 4 — Activity stream

Goal: recent changes are obvious.

- Query latest TaskEvent rows joined to tasks/missions.
- Show activity stream.
- Add cursor-ready service shape.
- Keep polling first.

Acceptance:

- Recent task starts/completions/nudges appear within 30 seconds.
- Activity stream does not expose raw payload noise.

### Slice 5 — Real-time SSE upgrade

Goal: near-live updates when multiple people use the dashboard.

- Add route handler for event stream.
- Use last event timestamp/id cursor.
- Client subscribes when tab visible.
- Fall back to polling on failure.

Acceptance:

- New TaskEvent appears without manual refresh.
- Lost connection recovers without duplicate rows.
- Polling remains fallback.

## 11. Hard constraints and traps

1. Do not create another project table unless missions cannot represent projects.
2. Do not add WebSockets before SSE/polling is proven insufficient.
3. Do not render progress from stale client math when service can compute it once.
4. Do not build comments before ownership is clean.
5. Do not make dashboard charts the main event. Deadline and next action beat vanity metrics.
6. Do not bypass existing task mutations; they emit events and preserve audit trails.
7. Do not leak Prisma `JsonValue` recursion through tRPC response types.
8. Do not touch main directly; branch + PR only.

## 12. Test plan

Unit tests for `buildProjectDashboardState()`:

- Counts only non-deleted missions/tasks.
- Excludes archived tasks from progress denominator.
- Groups overdue tasks using exact date boundaries.
- Groups today / next 7 days / later correctly.
- Flags active projects with no READY/DOING task.
- Flags high-ROI open tasks without due date.
- Computes done/open/waiting per project.
- Sorts deadline radar in correct order.
- Limits board columns to safe counts.

Component tests if test setup supports it:

- Renders empty state.
- Renders summary strip.
- Renders progress list.
- Start/complete buttons call provided handlers.

## 13. Definition of done

A first production-worthy version is done when:

- `/project-dashboard` exists and is owner-gated through existing app auth conventions.
- Dashboard loads from a typed tRPC endpoint.
- Summary, progress, deadlines, and task board render from real DB data.
- User can start and complete tasks from the dashboard.
- Data refreshes automatically.
- Tests cover the state builder.
- UI follows current statenour component and token conventions.
- No schema migration is introduced unless assignment requires it.

## 14. Strategic note

The dashboard should feel like a war room, not a spreadsheet. The point is not to know more; the point is to decide faster.

The first version should be slightly ugly and brutally useful. Then improve the surface once the data proves it changes behavior.
