#!/usr/bin/env node
/**
 * UserPromptSubmit reminder: load the applicable repo skills before any work this turn.
 *
 * Advisory only. Claude Code adds this stdout to the model's context on every prompt,
 * so the rule does not depend on what survives compaction. It never blocks a prompt: it has
 * no path to exit 2, the only exit code that vetoes one. Covered by skillsFirstReminder.test.mjs.
 */
process.stdout.write([
  "[skills-first] Before any work this turn, load every skill in .claude/skills/ and your available skills that applies.",
  "Route with nour-command and find-skill (see CLAUDE.md). Name the skills you used in your status update.",
  "Before claiming done, run verification-before-completion.",
  "",
].join("\n"));
