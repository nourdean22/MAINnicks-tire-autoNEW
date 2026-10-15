# LOOPS.md - the repeating cycles, and when each one stops

On demand. Every loop has an exit condition. A loop without one is drift.

## L1. Run-to-empty (any authorized workstream)

1. Pick the highest-leverage item that is actionable now and unblocks the most.
2. Execute it through the matching playbook (`PLAYBOOKS.md`).
3. Verify at the strongest rung you can reach.
4. Ask: what is the next actionable item the outcome still needs? Go to 1.
Stop when: the scoped backlog is empty, the rest needs Nour (spend, sends, prod writes, credentials),
or the next step is speculation. Run-to-empty finishes the authorized queue; it never invents a new one.
Two attempts at one item with no new evidence: change strategy or write it up as a precise blocker. Report done / blocked-on-X / not-started separately.

## L2. Verify (before every "done")

1. Name the command that proves the claim. 2. Run it fresh. 3. Read the summary line and exit code.
4. Claim only what the output shows. Stop when: the output matches the claim. If not, the claim changes.

## L3. Hostile self-review (before every push)

1. Re-read the full diff as a reviewer who wants to reject it.
2. Look for: missing callers, swallowed errors, a test that cannot fail, a doc that now lies, scope creep.
3. Fix, then re-run L2. Stop when: a full pass finds nothing new. Report what the passes found.

## L4. Memory (end of every task that taught something)

1. Is the lesson already in code, a test, AGENTS.md or a skill? Then skip it.
2. Durable repo fact or handoff -> `apps/<app>/.remember/`. Job outcome -> `docs/agent-os/MANAGER-LEDGER.md`.
3. Machine or operator preference -> agent memory (`~/.claude/projects/.../memory/`, one fact per file, indexed).
4. A lesson seen twice -> `session-observer` proposal (`docs/skill-proposals.md`).
Stop when: the next agent would find the lesson without being told.

## L5. Heartbeat (scheduled, twice daily)

1. Run `HEARTBEAT.md`. 2. HEALTHY: print the status block, no notification.
3. DEGRADED / FAILED / UNKNOWN: notify Nour with the status block and a proposed job for the manager.
Never auto-start a write from a heartbeat. Stop when: the status block is delivered.

## L6. Manager (multi-area job)

classify -> split by lane -> dispatch one agent per lane -> verify each diff -> probe the real binary yourself -> review before the PR opens -> integrate -> merge by protocol -> report -> ledger and metrics.
Full procedure: `.claude/skills/monorepo-manager/SKILL.md`. Stop when: every lane is merged, blocked or handed back.
