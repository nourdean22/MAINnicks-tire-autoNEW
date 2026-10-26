// SessionStart hook: re-arms the operator's always-on skills.
// Why: skills are invoked by the model's own judgement, so they lapse at the start of a
// session and after every context compaction (the compacted transcript keeps only a
// summary of them). This hook puts the instruction in front of the model at exactly
// those moments, on startup|resume|clear|compact.
// One file, two registrations (job 2026-10-26-always-on-hardening):
//   machine  ~/.claude/hooks/always-on-skills.mjs, a byte copy of this file installed by
//            scripts/agent-os/bootstrap-machine.mjs; always prints.
//   repo     .claude/settings.json runs this file with --repo, so a fresh clone, a cloud
//            session or another account is armed too; silent when the machine hook is
//            registered in ~/.claude/settings.json AND its file exists, so it never prints twice.
// Edit SKILLS / SCOPED here, then run the bootstrap so the machine copy matches.
// Canary: scripts/agent-os/alwaysOnRearm.test.mjs. Fails open: any error still prints the re-arm.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILLS = ["using-superpowers", "ponytail (args: full)", "karpathy-guidelines", "i-have-adhd", "verification-before-completion", "find-skills", "prompt-gallery", "steal-like-an-artist"];
const SCOPED =
  "antislop (then the matching antislop-* skill) when the work touches UI, user-facing copy, accessibility, mobile layout or code comments; " +
  "and, in the NOURCITY repo, monorepo-manager whenever a job spans more than one lane (nickstire server/client, statenour, worker, platform, research) " +
  "or Nour says manager, run the backlog, or continue the job; " +
  "and (Nour, 2026-10-19) whenever making any ad, reel, video, social post, caption, hook or other customer-facing creative: " +
  "ad-creative, video and social (makers), plus ads for campaign strategy and ads-creative, ads-meta, ads-tiktok when auditing or running a campaign, " +
  "together with the repo's reel-hook-mechanism and nickstire-reel-operator (never publish or spend without his live go)";

const home = () => process.env.USERPROFILE || process.env.HOME || homedir();

/** The machine hook counts only when ~/.claude/settings.json registers an always-on-skills.mjs that is not this repo
 * entry (no --repo) and the file it names exists: a dangling registration must not silence the repo re-arm. */
export function machineHookPresent(h) {
  try {
    const s = JSON.parse(readFileSync(join(h, ".claude", "settings.json"), "utf8"));
    return (s.hooks?.SessionStart ?? []).some((g) => (g.hooks ?? []).some((x) => {
      const cmd = String(x.command || "");
      if (!cmd.includes("always-on-skills.mjs") || cmd.includes("--repo")) return false;
      const file = /"([^"]*always-on-skills\.mjs)"|(\S*always-on-skills\.mjs)/.exec(cmd);
      return Boolean(file) && existsSync((file[1] ?? file[2]).replace(/^~(?=[\\/])/, h));
    }));
  } catch {
    return false; // unreadable settings: print, never stay silent on a guess
  }
}

function main(raw) {
  const repoMode = process.argv.includes("--repo");
  if (repoMode && machineHookPresent(home())) return;
  let source = "startup";
  try {
    source = JSON.parse(raw).source || source;
  } catch {
    // no or bad stdin: treat as a fresh session
  }
  const list = SKILLS.join(", ");
  const lead =
    source === "compact"
      ? "Context was just compacted. Skills invoked before the compaction now survive only as a summary, so they are no longer active."
      : "Operator rule for every session.";
  const additionalContext =
    `[always-on skills] ${lead} Before your next reply or tool call, call the Skill tool for: ${list}. ` +
    `Also ${SCOPED}. Do this even for a short question; naming a skill in prose is not invoking it, ` +
    `and the operator should never have to remind you.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
}

/** True when node was started on this file, so bootstrap-machine.mjs can import SKILLS without printing. */
function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  let raw = "";
  process.stdin.on("data", (c) => (raw += c));
  process.stdin.on("end", () => main(raw));
}
