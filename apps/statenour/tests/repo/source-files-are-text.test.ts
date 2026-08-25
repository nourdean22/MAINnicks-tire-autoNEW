/**
 * Every tracked source file must be readable as TEXT.
 *
 * THE DEFECT, handed over from the nickstire sweep session 2026-08-23 and found
 * live in this app the same hour. A single NUL byte (0x00) in a `.ts` file:
 *
 *   · compiles clean
 *   · typechecks clean
 *   · and makes the file read as BINARY to git and to every text-scanning tool
 *
 * grep, `git grep`, and every lint that walks files as text then SKIP the file
 * entirely — and report success. The sweep session's formulation is the sharpest
 * statement of the shape anyone produced today:
 *
 *     A scan that cannot read a file prints the same green as one that found
 *     nothing.
 *
 * That is the blind-instrument shape at its purest: the tool is wired, running,
 * and structurally incapable of seeing its subject, and its silence is
 * indistinguishable from a clean result. Identical in kind to `ingest-reviews`
 * reporting `lastResult: success` because it tracked the last run rather than
 * the streak.
 *
 * WHAT WAS FOUND HERE. Two files, both with DELIBERATE NUL delimiters — which is
 * a sound choice, since NUL cannot occur inside the strings being joined:
 *
 *   components/home/follow-ups-list.tsx        titles.join(<NUL>)
 *   lib/observability/persona-lane-census.ts   `${lane}<NUL>${taskClass}`
 *
 * The delimiter was never the problem. The ENCODING was: written as a raw 0x00
 * byte instead of the escape backslash-u-0000, which is six ASCII characters
 * producing the identical runtime string. Both now use the escape, so the semantics are
 * unchanged and the files are readable again.
 *
 * THIS FILE FAILED ITSELF ON ITS FIRST DRAFT. Writing it, I typed four raw NUL
 * bytes into the assertions and the doc comment - so the canary for unreadable
 * files was itself unreadable, and would have been skipped by the very scanners
 * it exists to protect. Caught by running the byte check against it. Every NUL
 * in this file is now the six-character escape; the only real 0x00 is the one
 * the positive control constructs from a byte array at runtime.
 *
 * THE POSITIVE CONTROL BELOW IS NOT OPTIONAL. My first sweep used
 * `grep -qP '\x00'` and reported zero NUL files across 2,901 files. Planting a
 * NUL in a temp file proved that detector never fires — the zero was worthless
 * and I nearly reported it as an all-clear. A scanner for unreadable files that
 * is itself unable to read them is the joke writing itself.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const NUL = 0x00;

/** Byte-level, because a string-level read is exactly what gets fooled here. */
function hasNulByte(path: string): boolean {
  return readFileSync(path).includes(NUL);
}

const TEXT_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "json", "md", "css", "sql", "sh", "yml", "yaml"]);

function trackedTextFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "--", "."], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((f) => TEXT_EXTENSIONS.has(f.split(".").pop() ?? ""));
}

describe("source files are text, so scanners can actually read them", () => {
  it("POSITIVE CONTROL: the detector fires on a planted NUL byte", () => {
    // Without this the suite is worthless. `grep -P '\\x00'` returned zero
    // across 2,901 files and was simply blind; this asserts the detector used
    // below can see the thing it is looking for BEFORE any zero is trusted.
    const probe = join(tmpdir(), `nul-probe-${process.pid}.ts`);
    try {
      writeFileSync(probe, Buffer.from([0x63, 0x6f, 0x6e, 0x73, 0x74, 0x20, NUL, 0x61, 0x0a]));
      expect(hasNulByte(probe), "the detector cannot see a NUL — every result below is meaningless").toBe(true);
    } finally {
      unlinkSync(probe);
    }
  });

  it("NEGATIVE CONTROL: an ordinary text file does not trip it", () => {
    const probe = join(tmpdir(), `text-probe-${process.pid}.ts`);
    try {
      writeFileSync(probe, "const a = 1;\n", "utf8");
      expect(hasNulByte(probe)).toBe(false);
    } finally {
      unlinkSync(probe);
    }
  });

  it("no tracked source file in this app contains a NUL byte", () => {
    const files = trackedTextFiles();
    // Guards the guard: if the file list ever comes back empty the assertion
    // below passes vacuously, which is the same failure one level up.
    expect(files.length, "git ls-files returned nothing — the scan had no subject").toBeGreaterThan(500);

    const offenders = files.filter(hasNulByte);
    expect(
      offenders,
      `these files read as BINARY, so every text-scanning lint silently skips them:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the two known offenders keep their NUL delimiter as an ESCAPE", () => {
    // The delimiter is deliberate and correct; only the encoding was wrong.
    // Pinned so a future edit does not "simplify" the escape back to a raw byte
    // and silently re-blind both files.
    const a = readFileSync("components/home/follow-ups-list.tsx", "utf8");
    expect(a).toContain('titles.join("\\u0000")');
    const b = readFileSync("lib/observability/persona-lane-census.ts", "utf8");
    expect(b).toContain("${lane}\\u0000${taskClass}");
  });

  it("the escape produces the identical runtime string a raw NUL would", () => {
    // The whole fix rests on this being true. If it were not, the change would
    // have altered two delimiters and broken a signature and a map key.
    expect("\u0000").toBe(String.fromCharCode(0));
    expect("\u0000".length).toBe(1);
    expect(["a", "b"].join("\u0000")).toBe(`a${String.fromCharCode(0)}b`);
  });
});
