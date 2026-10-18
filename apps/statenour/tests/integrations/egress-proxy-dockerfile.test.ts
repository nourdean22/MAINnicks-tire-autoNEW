/**
 * tests/integrations/egress-proxy-dockerfile.test.ts
 * Job 2026-10-18-camofox-live-fixes.
 *
 * The egress proxy Dockerfile is a deny list: its ENTRYPOINT arguments decide
 * which addresses camofox's browser may reach. On 2026-10-18 the merged file
 * passed `--listen-ip=::` and crash-looped on Railway, because Smokescreen
 * v0.1.0 joins ip and port as "%s:%d" with no brackets (":::4750", "too many
 * colons in address"). Nothing in the repo could fail before the live deploy.
 *
 * This file parses the real Dockerfile (comment lines dropped, continuation
 * lines joined, ENTRYPOINT read as the exec-form JSON array Docker runs) and
 * pins the arguments by value. A comment that quotes `--listen-ip=::` is
 * documentation and must not trip it. `audit()` is also run on mutated copies
 * of the real text, so each pin is proven to fire (and the comment is proven
 * not to).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DOCKERFILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../ops/egress-proxy/Dockerfile",
);
const REAL = readFileSync(DOCKERFILE, "utf8");

const DENY_RANGES = [
  "0.0.0.0/8",
  "100.64.0.0/10",
  "169.254.0.0/16",
  "192.0.0.0/24",
  "198.18.0.0/15",
  "240.0.0.0/4",
  "fc00::/7",
  "fe80::/10",
];

/** Dockerfile instructions: comment lines dropped, `\` continuations joined. */
function instructions(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("#")) continue;
    if (line === "" && cur === "") continue;
    if (line.endsWith("\\")) {
      cur += `${line.slice(0, -1)} `;
      continue;
    }
    out.push(`${cur}${line}`.trim());
    cur = "";
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function entrypointArgs(text: string): string[] | null {
  const eps = instructions(text).filter((i) => /^ENTRYPOINT\s/i.test(i));
  if (eps.length !== 1) return null;
  try {
    const parsed: unknown = JSON.parse(eps[0].replace(/^ENTRYPOINT\s+/i, ""));
    return Array.isArray(parsed) && parsed.every((a) => typeof a === "string") ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/** The values of every listen-ip argument, `--x=v`, `-x=v` and `--x v` spellings. */
function listenIpValues(args: string[]): string[] {
  const values: string[] = [];
  args.forEach((a, i) => {
    const m = /^--?listen-ip(?:=(.*))?$/.exec(a);
    if (m) values.push(m[1] ?? args[i + 1] ?? "");
  });
  return values;
}

/** Problem ids found in a Dockerfile text. Empty means every pin holds. */
function audit(text: string): string[] {
  const problems: string[] = [];
  const ins = instructions(text);
  const args = entrypointArgs(text);

  if (!args) {
    problems.push("entrypoint-not-exec-json");
  } else {
    if (args[0] !== "/smokescreen") problems.push("entrypoint-binary");
    if (listenIpValues(args).some((v) => v.includes(":"))) problems.push("listen-ip-colon");
    const ports = args.filter((a) => /^--?listen-port\b/.test(a));
    if (ports.length !== 1 || ports[0] !== "--listen-port=4750") problems.push("listen-port");
    const deny = args.filter((a) => a.startsWith("--deny-range=")).map((a) => a.slice("--deny-range=".length));
    if (deny.length !== DENY_RANGES.length || [...deny].sort().join() !== [...DENY_RANGES].sort().join()) {
      problems.push("deny-range-set");
    }
  }
  // The file has no CMD by design: Docker appends CMD args to an exec-form ENTRYPOINT.
  if (ins.some((i) => /^CMD(\s|$)/i.test(i))) problems.push("cmd-present");
  if (!ins.some((i) => /^EXPOSE\s+4750$/i.test(i))) problems.push("expose-port");

  const froms = ins.filter((i) => /^FROM\s/i.test(i));
  if (froms.length !== 2 || !froms.every((f) => /@sha256:[0-9a-f]{64}(\s|$)/.test(f))) problems.push("from-unpinned");

  const arg = ins.map((i) => /^ARG\s+SMOKESCREEN_COMMIT=([0-9a-f]{40})$/.exec(i)?.[1]).find(Boolean);
  if (!arg) {
    problems.push("commit-arg-missing");
  } else {
    const runs = ins.filter((i) => /^RUN\s/i.test(i));
    const check = /test\s+"\$\(git -C \/src rev-parse HEAD\)"\s+=\s+"\$SMOKESCREEN_COMMIT"/;
    if (!runs.some((r) => check.test(r))) problems.push("commit-check-missing");
    if (!runs.some((r) => /checkout --detach "\$SMOKESCREEN_COMMIT"/.test(r))) problems.push("commit-checkout-missing");
    const literals = runs.flatMap((r) => r.match(/\b[0-9a-f]{40}\b/g) ?? []);
    if (literals.some((l) => l !== arg)) problems.push("commit-literal-mismatch");
    // The documented pin (header comment) must name the commit the ARG builds.
    const documented = /commit ([0-9a-f]{40})/.exec(text)?.[1];
    if (documented !== arg) problems.push("commit-doc-mismatch");
  }
  return problems;
}

/** Apply a mutation and prove it changed something, so a no-op can never read as a kill. */
function mutate(text: string, from: string | RegExp, to: string): string {
  const out = text.replace(from, to);
  expect(out, `mutation did not change the text: ${String(from)}`).not.toBe(text);
  return out;
}

describe("egress-proxy Dockerfile: the unmodified file", () => {
  it("passes every pin (a failure here lists the problem ids)", () => {
    expect(audit(REAL)).toEqual([]);
  });

  it("starts Smokescreen with no listen-ip colon (the live crash: ':::4750')", () => {
    const args = entrypointArgs(REAL);
    expect(args).not.toBeNull();
    expect(listenIpValues(args!).filter((v) => v.includes(":"))).toEqual([]);
  });

  it("listens on 4750, EXPOSEs 4750 and denies all eight ranges", () => {
    const args = entrypointArgs(REAL)!;
    expect(args.filter((a) => a.startsWith("--listen-port"))).toEqual(["--listen-port=4750"]);
    expect(args.filter((a) => a.startsWith("--deny-range=")).map((a) => a.slice(13)).sort()).toEqual([...DENY_RANGES].sort());
    expect(instructions(REAL)).toContain("EXPOSE 4750");
  });

  it("pins both base images by digest and builds the one reviewed Smokescreen commit", () => {
    const froms = instructions(REAL).filter((i) => i.startsWith("FROM "));
    expect(froms).toHaveLength(2);
    for (const f of froms) expect(f).toMatch(/@sha256:[0-9a-f]{64}/);
    expect(instructions(REAL).some((i) => /^ARG SMOKESCREEN_COMMIT=[0-9a-f]{40}$/.test(i))).toBe(true);
  });
});

describe("egress-proxy Dockerfile: each pin fires on a mutated copy", () => {
  it("positive control: a comment that quotes --listen-ip=:: is documentation, not an argument", () => {
    expect(audit(`# tried --listen-ip=:: once\n${REAL}`)).toEqual([]);
  });

  it.each([
    ["long form with equals", /"--listen-port=4750"/, '"--listen-ip=::", "--listen-port=4750"'],
    ["single-dash spelling", /"--listen-port=4750"/, '"-listen-ip=::", "--listen-port=4750"'],
    ["bracketed IPv6", /"--listen-port=4750"/, '"--listen-ip=[::]", "--listen-port=4750"'],
    ["split into two arguments", /"--listen-port=4750"/, '"--listen-ip", "::1", "--listen-port=4750"'],
  ])("re-adding a listen-ip with a colon (%s) is caught", (_label, from, to) => {
    expect(audit(mutate(REAL, from, to))).toContain("listen-ip-colon");
  });

  // With an exec-form ENTRYPOINT, Docker appends CMD args to it, so a CMD brings the crash back
  // while the ENTRYPOINT array itself still reads clean.
  it.each([
    ['CMD ["--listen-ip=::"]'],
    ['CMD ["--listen-ip", "::1"]'],
    ['CMD ["--listen-ip=[::]"]'],
    ["CMD --listen-ip=::"],
  ])("a CMD instruction (%s) is caught", (cmd) => {
    expect(audit(`${REAL}\n${cmd}\n`)).toContain("cmd-present");
  });

  it("a comment that mentions CMD is not a CMD instruction", () => {
    expect(audit(`# no CMD here, by design\n${REAL}`)).toEqual([]);
  });

  it("a plain IPv4 listen-ip is not the crash and is not flagged", () => {
    expect(audit(mutate(REAL, /"--listen-port=4750"/, '"--listen-ip=0.0.0.0", "--listen-port=4750"'))).toEqual([]);
  });

  it("changing the listen port is caught", () => {
    expect(audit(mutate(REAL, '"--listen-port=4750"', '"--listen-port=4751"'))).toContain("listen-port");
  });

  it.each(DENY_RANGES)("dropping --deny-range=%s is caught", (range) => {
    // Swap the flag for a harmless one in the same slot, so the array stays valid JSON
    // and only the deny-range pin can be what fires.
    const without = mutate(REAL, `"--deny-range=${range}"`, '"--timeout=10s"');
    const problems = audit(without);
    expect(problems).toContain("deny-range-set");
    expect(problems).not.toContain("entrypoint-not-exec-json");
  });

  it.each([0, 1])("stripping the digest from FROM line %i is caught", (n) => {
    let seen = -1;
    const stripped = REAL.replace(/@sha256:[0-9a-f]{64}/g, (m) => (++seen === n ? "" : m));
    expect(stripped).not.toBe(REAL);
    expect(audit(stripped)).toContain("from-unpinned");
  });

  it("changing the commit in the ARG only is caught", () => {
    expect(audit(mutate(REAL, /(ARG SMOKESCREEN_COMMIT=)[0-9a-f]{40}/, `$1${"a".repeat(40)}`))).toContain("commit-doc-mismatch");
  });

  it("changing the commit in the rev-parse check only is caught", () => {
    const check = mutate(REAL, '= "$SMOKESCREEN_COMMIT"', `= "${"b".repeat(40)}"`);
    const problems = audit(check);
    expect(problems).toContain("commit-check-missing");
    expect(problems).toContain("commit-literal-mismatch");
  });
});
