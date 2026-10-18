#!/usr/bin/env node
/**
 * UserPromptSubmit reminder, one line: invoke the skills the skill-recall hook names for this prompt.
 *
 * Advisory only. Claude Code adds this stdout to the model's context on every prompt, so the rule does
 * not depend on what survives compaction. It never blocks a prompt: it has no path to exit 2, the only
 * exit code that vetoes one. The matching itself is skill-recall.mjs and tool-recall.mjs, registered right after this hook.
 * Covered by skillsFirstReminder.test.mjs.
 */
process.stdout.write(
  "[skills-first] Before any work this turn, invoke every skill the [skill-recall] lines below name, plus any you know applies (.claude/skills/, account and plugin skills), use the MCP servers, plugins, agents and CLIs the [tool-recall] lines name when they fit, name the skills AND the tools you used in your status update, and run verification-before-completion before claiming done.\n",
);
