#!/usr/bin/env node
/**
 * UserPromptSubmit reminder: before any work this turn, search every skill source and load the best matches.
 *
 * Advisory only. Claude Code adds this stdout to the model's context on every prompt,
 * so the rule does not depend on what survives compaction. It never blocks a prompt: it has
 * no path to exit 2, the only exit code that vetoes one. Covered by skillsFirstReminder.test.mjs.
 */
process.stdout.write([
  "[skills-first] Before any work this turn, load the best skills for this task: search every skill source first (repo skills in .claude/skills/, account skills and plugin skills).",
  "Use SearchSkills or ListSkills (ToolSearch loads them if deferred), and load every skill that applies, not only the always-on ones. This searches the skill catalogue, not the web.",
  "Route with nour-command and find-skill (see CLAUDE.md). Name the skills you used in your status update.",
  "Before claiming done, run verification-before-completion.",
  "",
].join("\n"));
