// UserPromptSubmit hook (operator, 2026-10-17): before every turn, remind the model that find-skills
// (vercel-labs/skills, skills.sh search) exists for capabilities no installed skill covers.
// One line, no network, fails open. Registered in ~/.claude/settings.json UserPromptSubmit.
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  process.stdout.write(
    "[find-skills] If this request needs a capability no installed skill covers, invoke find-skills " +
      "(searches skills.sh with `npx skills find`) before building it yourself; propose installs, never run them unasked.\n",
  );
});
