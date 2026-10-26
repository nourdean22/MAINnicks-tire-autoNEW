## NOURCITY always-on (machine copy of the repo stance)

- SessionStart hook `~/.claude/hooks/always-on-skills.mjs` re-arms the always-on skills at startup, resume, clear and compact; the NOURCITY repo carries the same file at `scripts/agent-os/always-on-skills.mjs` and arms clones and cloud sessions that lack this one.
- UserPromptSubmit runs the repo's `skill-recall.mjs --scope global` (repo, user and enabled plugin skills) and `find-skills-turn.mjs`.
- Refresh or repair all of it from the repo: `node scripts/agent-os/bootstrap-machine.mjs` (`--check` only reports). Required plugins: `config/agent-os/required-plugins.json`.
