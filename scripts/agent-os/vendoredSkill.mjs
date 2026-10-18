/**
 * Which skill folders are vendored upstream copies (2026-10-18, job skills-repo-adoption).
 *
 * A vendored SKILL.md is kept byte-identical to its upstream, so the repo-authored gates (a `triggers:` line, name equal
 * to the folder, the skill-count sentence's two-part sum) cannot be met by editing it. A folder counts as vendored only
 * when its SOURCE.md pins a full 40-hex sha AND docs/UPSTREAMS.md names that same sha: the register row is the receipt,
 * so a bare SOURCE.md cannot be used to dodge a gate. Any read problem answers false, which keeps the full gates on.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export function isVendoredSkill(skillDir, repoRoot) {
  try {
    const src = join(skillDir, "SOURCE.md");
    if (!existsSync(src)) return false;
    const sha = /^Pinned: ([0-9a-f]{40})\s*$/m.exec(readFileSync(src, "utf8"))?.[1];
    return Boolean(sha) && readFileSync(join(repoRoot, "docs", "UPSTREAMS.md"), "utf8").includes(sha);
  } catch {
    return false;
  }
}
