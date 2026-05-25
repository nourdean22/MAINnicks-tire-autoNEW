# Task-Intelligence Framework

**Skill port:** A3 · task-intelligence
**Applies to:** statenour `/tasks` page, admin priority queue, the work-order automation pipeline, the daily-execution surface.
**Authored:** 2026-05-26.

## Why this doc exists

The operator's task list grows faster than it gets reviewed. Without priority intelligence, the WIP becomes a backlog graveyard · important work buried, trivial work bubbling up because it's recently-added.

Task-intelligence skill argues · use pattern learning, dependency analysis, and explicit operator-state input to auto-prioritize. The result: when the operator opens /tasks at 7 AM, the right task is at the top without scrolling.

## The 4 prioritization signals

Each task gets scored on 4 dimensions. The composite drives sort order.

### Signal 1 · EXPLICIT URGENCY (weight 0.4)

Operator-or-system-set urgency flag. Highest weight because it's the operator's stated preference.

| Value | Source |
|---|---|
| 5 | Manual operator flag · "do this today" |
| 4 | System-detected · "customer waiting >24h" |
| 3 | Cron-default · standard task |
| 2 | Background · "would be nice" |
| 1 | Someday · explicit defer |

### Signal 2 · BLOCKING (weight 0.3)

Is this task blocking other tasks?

```
blocking_score = 1 + log(num_tasks_blocked + 1)
```

A task blocking 4 other tasks gets ~1.7. A task blocking nothing gets 1.

### Signal 3 · STALENESS (weight 0.2)

How long since the task was created OR last touched?

| Days old | Score |
|---|---|
| 0-2 | 1.0 (fresh) |
| 2-7 | 0.8 |
| 7-30 | 0.6 |
| 30-90 | 0.3 |
| 90+ | 0.1 (likely dead) |

Counterintuitive · OLDER tasks get LOWER priority. If it's been 90 days, it's either dead OR low-priority by revealed preference.

### Signal 4 · CONTEXT MATCH (weight 0.1)

Match between task category and operator's CURRENT operating state (per memory's `operatorStateSnapshot` from #41/#49).

| Operator state | Boosted categories |
|---|---|
| Strategic | Planning · Brand · Brain consolidation |
| Tactical | Daily execution · Customer follow-up · Cron tuning |
| Reactive | Incident response · Audit fixes · Bug fix |
| Reflective | Postmortems · Journal · Pattern review |

A "fix the cron lock bug" task ranks higher when operator is in Reactive state · lower when Strategic. This is the personalized layer.

### Composite

```
score = 0.4 * urgency + 0.3 * blocking + 0.2 * staleness + 0.1 * context_match
```

Sort descending. Top 5 land in the operator's morning view.

## Dependency tracking

Per memory's #22 true subtasks migration · the schema already supports `parentTaskId`. Extend this with explicit "blocks" relationships:

```sql
CREATE TABLE task_dependencies (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  blocker_task_id INT NOT NULL,
  blocked_task_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_dep (blocker_task_id, blocked_task_id),
  INDEX idx_blocker (blocker_task_id),
  INDEX idx_blocked (blocked_task_id)
)
```

This lets `blocking_score` actually mean something · without the table it's always 1.

## Completion-pattern learning

Daily cron · for each completed task, record:
- Time-of-day completed
- Day-of-week completed
- Operator-state when completed
- Time elapsed from creation to completion
- Category

After 30 days of data, surface patterns:
- "You complete brand tasks 80% on Tuesday mornings → schedule brand-related new tasks for Tuesday"
- "Customer-follow-up tasks completed in <4h have 60% conversion. Tasks completed in >24h have 12% conversion → escalate stale customer-follow-ups"
- "Tasks tagged 'maybe-someday' have a 3% completion rate over 90 days → auto-archive after 60d"

The pattern surface is in /scoreboard or /journal · NOT in /tasks (you don't want to lecture the operator while they're trying to work).

## Anti-patterns

### "Everything is urgent"

When 80% of tasks have urgency=5, the score is meaningless. Cap · only top 10% of active tasks can have urgency=5 at any time. Adding a new urgency=5 demotes an older one.

### "Score visible to operator"

Don't show the operator the score. Show the SORTED ORDER. The score is internal · arguing about the score is procrastination · just do the top task.

### "No archive policy"

Tasks that pass 90 days stale should auto-archive (not delete · move to a different list). The operator can search archive. The active list stays focused.

### "Recurring tasks dominate"

Recurring tasks (weekly cleanup, monthly reconciliation) should live in a SEPARATE list · not compete with one-shot work for top-of-list attention.

## Implementation plan (queued)

1. Add `urgency` (1-5) + `blocked_by` references to the task schema (per #22 migration, parentTaskId is already there)
2. Build the 4-signal scoring function as a tRPC query · returns sorted task list
3. Daily cron writes completion-pattern data to a `task_completion_patterns` table
4. Pattern-detection cron (weekly) writes insights to operator's nudge inbox
5. /tasks page consumes the sorted query · operator sees the right task first
6. Per Wave V autonomous-action tiers · auto-archive (Tier-3 self-healing) of 90+ day stale tasks

## Skill-port lineage

A3 from the audit's Round 2. Builds on:
- Memory #22 · parentTaskId self-FK migration (the schema foundation)
- Memory #41 · operatorStateSnapshot (the context_match signal)
- Memory #46 · psychographic profile (could become a signal in a future iteration)
- Wave W · dashboard-storytelling (how the priority queue renders)
- Wave V · autonomous-action tiers (auto-archive is Tier-3)

Future · the pattern-detection layer can predict NEXT task before operator picks it · "you usually do X after Y · X is now top of list."
