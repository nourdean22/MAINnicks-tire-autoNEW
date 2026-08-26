/**
 * prompt:size-check must SKIP LOUDLY without a DATABASE_URL, never fail the chain.
 *
 * THE DEFECT. `measure-prompt-size.ts` is step 18 of `verify:hard` and it builds
 * the real system prompt against LIVE Neon (its own docstring: "Calls
 * buildSystemPrompt() against LIVE Neon data"). A worktree without credentials
 * therefore red-lined the entire 19-step chain on step 18 — so the rational move
 * became not running `verify:hard` at all, and the other eighteen gates went with
 * it. A gate that blocks correct work gets routed around, and then it guards
 * nothing.
 *
 * WHY THIS FILE IS NOT JUST "assert it exits 0". Making a gate skip is
 * weakening it, and the only thing that makes the trade acceptable is that a
 * skip cannot be mistaken for a pass. So the arms assert the BANNER's content —
 * that it says SKIPPED, says the prompt was NOT measured, and never prints the
 * word PASS — not merely the exit code. An exit-code-only canary would be green
 * for a silent skip, which is the version of this change that would be a bug.
 *
 * CI IS EXEMPT FROM THE EXEMPTION and that arm is here for a day that has not
 * happened yet: the script is in no workflow today, so if someone wires it in
 * without a DATABASE_URL, a skip would be a false green in the one place nobody
 * re-reads. It fails there instead.
 */
import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { resolveDbGate } from "../../scripts/_lib/db-gate";

describe("resolveDbGate · the decision, driven by fixtures this file owns", () => {
  it("measures when DATABASE_URL is present", () => {
    expect(resolveDbGate({ DATABASE_URL: "postgres://x" }).action).toBe("measure");
    // Present AND in CI is still a normal measured run.
    expect(resolveDbGate({ DATABASE_URL: "postgres://x", CI: "true" }).action).toBe("measure");
  });

  it("skips — loudly — when DATABASE_URL is absent outside CI", () => {
    const g = resolveDbGate({});
    expect(g.action).toBe("skip");
    expect(g.message).toContain("SKIPPED");
    expect(g.message).toContain("NOT measured");
    // The load-bearing one. A skip that reads like a pass is the bug this
    // change would otherwise introduce.
    expect(g.message, "a skip must never print the word PASS").not.toContain("PASS");
  });

  it("FAILS instead of skipping when CI is set", () => {
    const g = resolveDbGate({ CI: "true" });
    expect(g.action).toBe("fail");
    expect(g.message).toContain("FAIL");
    expect(g.message).toContain("CI=true");
  });

  it("an empty DATABASE_URL counts as absent, not as present", () => {
    // `if (env.DATABASE_URL)` is falsy on "" — pinned because a truthiness
    // check is exactly the kind of thing a later refactor turns into
    // `"DATABASE_URL" in env`, which would try to measure against an empty
    // connection string and produce a confusing Prisma crash instead of a skip.
    expect(resolveDbGate({ DATABASE_URL: "" }).action).toBe("skip");
  });
});

describe("the decision is actually WIRED into main()", () => {
  const src = () => readFileSync(resolve(__dirname, "../../scripts/measure-prompt-size.ts"), "utf8");

  it("main() INVOKES it — not merely imports the name", () => {
    // CONTROL-CANARY-COVERAGE.md, "assert the INVOCATION, never the
    // identifier": a canary that matched `resolveDbGate` would also match this
    // file's own import line and stay green after the call site was deleted.
    expect(src()).toMatch(/const\s+gate\s*=\s*resolveDbGate\(process\.env\)/);
    expect(src()).toMatch(/process\.exit\(gate\.action === "fail" \? 1 : 0\)/);
  });
});

describe("END TO END · the real CLI, run without a DATABASE_URL", () => {
  // The arms above prove the DECISION. This one proves the SCRIPT: it runs the
  // actual file through tsx with cwd set to an empty temp directory, so
  // loadEnv() — which reads .env/.env.local relative to process.cwd() — finds
  // nothing and DATABASE_URL is genuinely absent. This works only because the
  // gate fires BEFORE the dynamic `@/lib/ai/system-prompt` import; nothing that
  // needs the project root is loaded on the skip path.
  const SCRIPT = resolve(__dirname, "../../scripts/measure-prompt-size.ts");
  const TSX = resolve(__dirname, "../../node_modules/tsx/dist/cli.mjs");

  it("exits 0 and prints the SKIPPED banner", () => {
    expect(existsSync(TSX), "tsx not resolvable — the arm would be vacuous").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "promptsize-"));
    try {
      const env = { ...process.env };
      delete env.DATABASE_URL;
      delete env.CI; // vitest may set it; this arm is the non-CI path
      // spawnSync, NOT execFileSync. The banner goes to STDERR (console.warn),
      // and execFileSync returns only stdout when the exit code is 0 — so the
      // first version of this arm read an empty string and failed with
      // "expected '' to contain 'SKIPPED'" even though the script was behaving
      // correctly. spawnSync hands back status, stdout and stderr on every path.
      const r = spawnSync(process.execPath, [TSX, SCRIPT, "--yes"], {
        cwd: dir,
        env,
        encoding: "utf8",
      });
      const code = r.status ?? 1;
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(code, `the missing-credentials path must not fail the chain:\n${out}`).toBe(0);
      expect(out).toContain("SKIPPED");
      expect(out).toContain("NOT measured");
      expect(out, "a skip must never print the word PASS").not.toContain("PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});

/**
 * The 65,000-char runtime cap has FOUR hand-maintained copies, three of them
 * carrying "keep in sync" comments that nothing enforced:
 *
 *   app/api/ai/chat/finalize-system-prompt.ts:118  MAX_SYSTEM_CHARS  <- the ROOT
 *   lib/ai/system-prompt.ts:153                    NON_ANTHROPIC_RUNTIME_CAP
 *   lib/services/chat-prompt-inspect.ts:100        maxSystemChars
 *   scripts/measure-prompt-size.ts                 RUNTIME_MAX
 *
 * The root is the one that actually slices the prompt at runtime. The other
 * three exist because importing the prompt graph is not always possible where
 * the number is needed — measure-prompt-size in particular cannot import it at
 * module load, because that runs before neutralizeServerOnly() and loadEnv().
 *
 * A comment is not a mechanism. If someone raises the real cap, every copy that
 * forgets to follow becomes a gate measuring against a stale threshold — and
 * measure-prompt-size would report PASS on a prompt that gets truncated in
 * production, which is the precise failure it exists to prevent. This arm makes
 * that divergence red.
 *
 * Each extraction is asserted to have SUCCEEDED before the values are compared.
 * Without that, a moved constant makes every regex return undefined and
 * `undefined === undefined` passes — a vacuous green in a sync check.
 */
describe("the runtime cap agrees across all four copies", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");
  const num = (s: string | undefined) => (s === undefined ? undefined : Number(s.replace(/_/g, "")));

  it("every copy is extractable and equal to the root", () => {
    const root = num(
      /MAX_SYSTEM_CHARS\s*=\s*provider\s*===\s*"anthropic"\s*\?\s*[\d_]+\s*:\s*([\d_]+)/.exec(
        read("app/api/ai/chat/finalize-system-prompt.ts"),
      )?.[1],
    );
    const mirror = num(
      /NON_ANTHROPIC_RUNTIME_CAP\s*=\s*([\d_]+)/.exec(read("lib/ai/system-prompt.ts"))?.[1],
    );
    const inspect = num(
      /maxSystemChars\s*=\s*provider\s*===\s*"anthropic"\s*\?\s*[\d_]+\s*:\s*([\d_]+)/.exec(
        read("lib/services/chat-prompt-inspect.ts"),
      )?.[1],
    );
    const script = num(/RUNTIME_MAX\s*=\s*([\d_]+)/.exec(read("scripts/measure-prompt-size.ts"))?.[1]);

    // Extraction first — a moved constant must fail LOUDLY here, not silently
    // make the equality below compare undefined to undefined.
    for (const [label, v] of Object.entries({ root, mirror, inspect, script })) {
      expect(v, `${label}: could not extract the cap — the constant moved, fix this regex`).toBeTypeOf("number");
      expect(Number.isFinite(v), `${label}: extracted a non-number`).toBe(true);
    }

    expect(mirror, "lib/ai/system-prompt.ts NON_ANTHROPIC_RUNTIME_CAP drifted from the root").toBe(root);
    expect(inspect, "lib/services/chat-prompt-inspect.ts maxSystemChars drifted from the root").toBe(root);
    expect(script, "scripts/measure-prompt-size.ts RUNTIME_MAX drifted from the root").toBe(root);
  });

  it("the docstring states the cap the code actually uses", () => {
    // The defect this arm exists for: the header claimed a 40,000-char default
    // for as long as the file existed, while the code used 65,000 — a
    // measurement tool misstating its own threshold by 25,000 chars.
    //
    // ASSERT THE CLAIM, NEVER A MENTION. The first version of this arm read
    // `expect(header).toContain("65,000")` and did NOT fire when the claim
    // sentence was staled to 40,000 — because the header mentions the number
    // twice, once as the claim and once in the changelog paragraph recording
    // what the old wrong value was. The surviving mention satisfied it. That is
    // the "canary matched its own import line" shape from
    // CONTROL-CANARY-COVERAGE.md, wearing documentation instead of code.
    // Capturing from the authoritative sentence is what makes it bite.
    const src = read("scripts/measure-prompt-size.ts");
    const header = src.slice(0, src.indexOf(" */"));
    const script = num(/RUNTIME_MAX\s*=\s*([\d_]+)/.exec(src)?.[1])!;
    const claimed = num(/THE CAP IS ([\d,]+) CHARS/.exec(header)?.[1].replace(/,/g, ""));
    expect(claimed, "the header no longer states its cap in the pinned form 'THE CAP IS <n> CHARS'").toBeTypeOf(
      "number",
    );
    expect(claimed, "the header's stated cap disagrees with RUNTIME_MAX").toBe(script);
  });
});
