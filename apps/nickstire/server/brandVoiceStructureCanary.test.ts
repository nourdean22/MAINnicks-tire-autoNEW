/**
 * End-to-end canary for the structure rules and the widened brand-voice scope
 * (job 2026-10-30-antislop-humanizer-pages, PR F). It runs the REAL linter as a
 * child process and asserts on exit codes AND rule ids in the output, because a
 * config or parse error also exits non-zero (guard-red-team).
 *
 * Staging follows lintGateFailClosed.test.ts: a throwaway GIT_INDEX_FILE seeded
 * from HEAD, the probe written straight into it as a blob. Nothing touches the
 * working tree or the real index, so a crash cannot strand a probe file.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const APP = process.cwd();
const SCRIPT = "scripts/lint-brand-voice.ts";
const CHILD_MAX_BUFFER = 8 * 1024 * 1024;
const PASS_LINE = /· 0 violations · ok/;

/** Stage the given repo-root-relative files (path -> full content) and run the gate. */
function runStaged(files: Record<string, string>) {
  const indexFile = join(tmpdir(), `bv-structure-${process.pid}-${Math.random().toString(36).slice(2)}.index`);
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  delete (env as Record<string, string | undefined>).GIT_DIR;
  const git = (args: string[], input?: string) =>
    spawnSync("git", args, { cwd: APP, env, encoding: "utf8", input, maxBuffer: CHILD_MAX_BUFFER });
  try {
    expect(git(["read-tree", "HEAD"]).status, "could not seed the scratch index").toBe(0);
    for (const [path, source] of Object.entries(files)) {
      const blob = git(["hash-object", "-w", "--stdin"], source);
      expect(blob.status, "could not write the probe blob").toBe(0);
      expect(
        git(["update-index", "--add", "--cacheinfo", `100644,${blob.stdout.trim()},${path}`]).status,
        `could not stage ${path}`,
      ).toBe(0);
    }
    const r = spawnSync("pnpm", ["exec", "tsx", SCRIPT], {
      cwd: APP,
      env,
      encoding: "utf8",
      shell: true,
      timeout: 180_000,
      maxBuffer: CHILD_MAX_BUFFER,
    });
    return { out: `${r.stdout ?? ""}${r.stderr ?? ""}`, code: r.status };
  } finally {
    rmSync(indexFile, { force: true });
  }
}

/** A real in-scope data file with one probe line appended, so the diff is that line alone. */
function appendTo(rel: string, line: string): Record<string, string> {
  const src = readFileSync(join(APP, rel), "utf8");
  return { [`apps/nickstire/${rel}`]: `${src.replace(/\s*$/, "\n")}${line}\n` };
}

// Until STRUCTURE_WARN_UNTIL (scripts/lib/brandVoiceScope.ts), structure hits outside the
// cleaned files and every hit in a newly scoped data file are reported as warn. These
// canaries pin both halves: BLOCK where the copy is clean, REPORTED-but-not-blocking where
// the page group has not been cleaned yet. Both must SEE the hit; a warn that prints nothing
// would be a blind gate.
describe("brand-voice gate: structure rules and widened scope (deny canaries)", () => {
  it("BLOCKS a prose dash added to a cleaned page (Home.tsx)", () => {
    const { out, code } = runStaged(
      appendTo("client/src/pages/Home.tsx", 'export const ZZ_STRUCTURE_PROBE = "Written quote — you approve first.";'),
    );
    expect(code).not.toBe(0);
    expect(out).toMatch(/structure\.dash · block/);
  }, 200_000);

  it("BLOCKS every pass-2 phrase class added to a page cleaned in pass 2 (CityPage.tsx)", () => {
    const { out, code } = runStaged(
      appendTo(
        "client/src/pages/CityPage.tsx",
        'export const ZZ_PASS2_PROBE = "Drive with peace of mind. Bedford drivers trust Nick\'s for it. Looking for another service? Here\'s what happens next. Professional service, every visit.";',
      ),
    );
    expect(code).not.toBe(0);
    for (const id of ["stock-phrase", "reader-flattery", "rhetorical-cta", "staged-runup", "empty-claim"]) {
      expect(out, id).toMatch(new RegExp(`structure\\.${id} · block`));
    }
  }, 200_000);

  it("REPORTS (warn, not blocking) a dash on a page not cleaned yet", () => {
    const { out, code } = runStaged({
      "apps/nickstire/client/src/pages/ZzStructureProbe.tsx":
        "export function ZzStructureProbe() {\n  return <p>Written quote — you approve first.</p>;\n}\n",
    });
    expect(code, out).toBe(0);
    expect(out).toMatch(/structure\.dash · warn/);
  }, 200_000);

  it("REPORTS a negation tail added to shared/neighborhoods.ts (a data file the gate did not read before)", () => {
    const { out, code } = runStaged(
      appendTo("shared/neighborhoods.ts", 'export const ZZ_STRUCTURE_PROBE = "Free check. No pressure, no upsells.";'),
    );
    expect(code, out).toBe(0);
    expect(out).toMatch(/structure\.negation-tail · warn/);
  }, 200_000);

  it("REPORTS a kill-list word added to client/src/data (word rules now reach data files too)", () => {
    const { out, code } = runStaged({
      "apps/nickstire/client/src/data/ZzStructureProbe.ts": 'export const ZZ = "A reliable shop for every car.";\n',
    });
    expect(code, out).toBe(0);
    expect(out).toMatch(/cliche\.reliable · warn/);
  }, 200_000);
});

describe("brand-voice gate: what it must let through (allow canaries)", () => {
  it("passes a placeholder dash, a dash inside a comment, and plain copy", () => {
    const { out, code } = runStaged({
      "apps/nickstire/client/src/pages/ZzStructureAllow.tsx": [
        "// Header — a comment, not copy.",
        "export function ZzStructureAllow({ v }: { v?: string }) {",
        '  return <p>{v ?? "—"} Written quote first. You approve it.</p>;',
        "}",
        "",
      ].join("\n"),
    });
    expect(code, out).toBe(0);
    expect(out).toMatch(PASS_LINE);
  }, 200_000);

  it("does not apply structure rules to an SMS surface (calls-texts lane copy is untouched)", () => {
    const { out } = runStaged({
      "apps/nickstire/server/cron/jobs/zzProbeSequences.ts": 'export const ZZ = "Quote ready — no pressure, no upsells.";\n',
    });
    expect(out).not.toMatch(/structure\./);
  }, 200_000);
});
