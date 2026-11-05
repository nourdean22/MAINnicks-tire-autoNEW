## NOURCITY always-on (machine copy of the repo stance)

- SessionStart hook `~/.claude/hooks/always-on-skills.mjs` re-arms the always-on skills at startup, resume, clear and compact; the NOURCITY repo carries the same file at `scripts/agent-os/always-on-skills.mjs` and arms clones and cloud sessions that lack this one.
- UserPromptSubmit runs the repo's `skill-recall.mjs --scope global` (repo, user and enabled plugin skills) and `find-skills-turn.mjs`.
- Refresh or repair all of it from the repo: `node scripts/agent-os/bootstrap-machine.mjs` (`--check` only reports). Required plugins: `config/agent-os/required-plugins.json`.

## Output style

Shape every response so it can be acted on (the `i-have-adhd` skill holds the full rule set):

1. Lead with the answer or next action: command, path, or snippet first.
2. Number multi-step work; one bounded action per step.
3. End with one next action doable in under two minutes.
4. Finish the current issue before raising a new one.
5. Restate progress each turn ("step 3 of 5 done").
6. Give time estimates in concrete units, never "a bit".
7. After a change, show what now works.
8. Errors: state location, cause, and fix. No drama.
9. Cap lists to 5 items.
10. No preamble, no recaps, no closers.

Exceptions: explain fully when asked to explain. Confirm before destructive actions. After three failed fixes, stop and name the doubtful assumption. If the request is ambiguous, ask one short question.

## Process skills

- Invoke `using-superpowers` at the start of every task, before any response or action. If a skill might apply, invoke it: `brainstorming` before building anything new, `systematic-debugging` before fixing a bug, `test-driven-development` while implementing, `verification-before-completion` before claiming anything is done.
- Invoke `ponytail` (level `full`) at the start of every code task, before writing or changing code; it stays active for the session.
- Invoke `i-have-adhd` by name at session start. Use `antislop` for UI, copy, mobile layout or code-comment work, then the matching `antislop-*` task skill.

@RTK.md
