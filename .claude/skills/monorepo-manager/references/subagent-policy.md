# Subagent policy (full text)

Moved here verbatim from CLAUDE-OPERATING-PROFILE.md on 2026-10-22 so the always-loaded profile carries only the rules
(every "never" and "always" line stayed there). This file keeps the numbers, the history and the rationale. Read it before briefing or dispatching a subagent.

---

SUBAGENT POLICY
━━━━━━━━━━━━━━━━━━━━━━━

Subagents (Task tool — code-explorer / code-reviewer / code-simplifier / Explore / general-purpose / etc.) are encouraged for parallelization, research, and bounded execution, except that Explore/census-style spawns happen only when the operator asks (he rejected two unrequested ones on 2026-10-08); otherwise run the pass in-session. Lane dispatch under `monorepo-manager` is the standing exception. Every invocation MUST follow these rules:

1. INHERIT THE STANCE — state the operating stance in the agent prompt explicitly; don't assume the agent re-derives it. Invoke karpathy-guidelines for code work, brainstorming for new builds, and the right reasoning lens.

2. BRIEF LIKE A COLLEAGUE — terse command prompts produce shallow slop. Give the agent: what you're accomplishing and why · what you've learned or ruled out · file paths and line numbers · the form of the answer expected.

3. VERIFY, DON'T TRUST — agent summaries describe intent, not reality. When an agent writes code, READ THE DIFF before reporting done. When it reports findings, spot-check 1-2 against the actual files. For any claim that a value/table/path is UNUSED, code-grep is NOT evidence in either direction — confirm against the running system before deleting, and before believing a "no rows" claim (2026-07-30: two mapper agents were refuted in OPPOSITE directions — 241 live rows behind a "no writer" claim, 2 rows behind a "zero rows" claim). Agents get no prod credentials; the orchestrator runs the probe.

4. SAME QUALITY BAR — the red-flags list applies to agent output too. Reject "we might need this", "refactor later", and AI-slop visuals. No exceptions.

5. PARALLELIZE INDEPENDENT WORK — independent agent calls go in ONE message with multiple Task blocks. Serial only when a downstream agent needs an upstream finding.

6. CHOOSE THE RIGHT AGENT TYPE — Explore (narrow lookups) · code-explorer (architecture audits) · code-architect (blueprints) · code-reviewer (bug/security review) · code-simplifier (refactoring) · general-purpose (open-ended research only when nothing else fits).

7. SCOPE TIGHT — for audits say "read-only · do not modify files". For implementation, name exactly which files the agent may touch. Never let an agent free-roam edit.

Agents are force multipliers, not autonomous workers — they inherit your standards or they don't run.
