/**
 * tests/repo/flag-board-visibility-ratchet.test.ts · 2026-09-18
 *
 * A switch read straight off `process.env` and never added to FLAG_REGISTRY is
 * INVISIBLE: it does not appear on the flag board, so nobody can see whether
 * it is on, and nothing can be given a shadow review before it flips.
 *
 * This is a repeat defect, not a hypothesis. CURRENT-TRUTH.md records the same
 * shape being fixed once already on 2026-08-19: "Both were LIVE-by-default via
 * raw `process.env.X !== '0'` reads in memory-manager.ts and appeared NOWHERE
 * on the flag board — the two most consequential memory switches were
 * invisible." Registering those two did not stop the next one:
 * NICK_MEMORY_SUPERSESSION was still a raw read at memory-manager.ts:461 when
 * this test was written, and the measurement below found NINE more.
 *
 * ★ Worth naming: NICK_FAILOVER_RESCUE is one of them, and CURRENT-TRUTH.md
 * says the operator ENABLED it in production on 2026-08-15. A live production
 * switch that the flag board cannot show is exactly the failure this guards.
 *
 * RATCHET, not a wall. Failing on every unregistered key at once would have
 * made this red on arrival and got it routed around. It freezes the known set
 * and fails on anything NEW — the same shape as `pnpm check:scripts`
 * (`.scripts-tsc-baseline.json`) and the brain plan's direct-writer ratchet.
 * The list may only SHRINK: registering a key and leaving it here also fails,
 * so the baseline cannot rot into a permanent excuse.
 *
 * ★ IT WORKED, SAME DAY: the baseline opened at 11 keys and fell to 4 that day. Every
 * real SWITCH among them is registered as a `readOnly` mirror (the runtime
 * still reads raw `process.env`; readOnly means a stale DB override cannot
 * make the board contradict it). What is left is exactly the four NUMERIC
 * KNOBS — NICK_CALIBRATION_K, NICK_TOOL_BUDGET, NICK_TOOL_TIMEOUT_MS,
 * NICK_ESCALATION_DAILY_CAP. Those stay baselined on purpose: they are values,
 * not on/off state, and a board built for switches would misrepresent them.
 * They still may not multiply unnoticed.
 *
 * 2026-10-10 (audit 03-F13): the scan only saw NICK_* names, so five live
 * switches with other prefixes were invisible, one of them gating customer SMS.
 * It now also flags any switch-shaped read (process.env.X === or !== a string
 * literal) under any name. Six non-NICK names are baselined: NODE_ENV and
 * VERCEL_ENV (environment identity), DEBUG_SQL and E2E_PLAIN_PG (dev/test),
 * TTS_ENGINE (an engine selector) and ANTHROPIC_MYTHOS_ENABLED (a real switch,
 * baselined by the R3 plan; registering it is the next shrink).
 * IMAGES_REQUIRE_SIGNATURE is read through a constant (env[IMAGE_SIGNATURE_FLAG]),
 * which no text scan sees; its registry row is pinned by the PREDICATES table in
 * tests/lib/feature-flags-registry.test.ts instead.
 *
 * Keep this header honest as the number moves. An out-of-date count in a
 * comment is a cache with no invalidation — the exact defect the wave that
 * created this file spent a commit correcting elsewhere.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Unregistered as of 2026-09-18. May only shrink — see the header.
 *
 * The last two were invisible to the first version of this gate, which walked
 * `lib/` only. Widening the scan to `app/` surfaced them immediately, which is
 * the argument for the wider scan in one line.
 */
const KNOWN_UNREGISTERED = [
  // 2026-09-18, SECOND PASS: the seven real SWITCHES that were here are now
  // registered (readOnly mirrors — see lib/feature-flags.ts). What remains is
  // exactly the four NUMERIC KNOBS, which stay baselined deliberately: they
  // are values, not on/off state, and a board built for switches would
  // misrepresent them. If this list ever reaches zero, delete the baseline
  // rather than leaving an empty array to rot.
  "NICK_CALIBRATION_K",
  "NICK_ESCALATION_DAILY_CAP",
  "NICK_TOOL_BUDGET",
  "NICK_TOOL_TIMEOUT_MS",
  // 2026-10-10: switch-shaped reads under other names (see the header).
  "ANTHROPIC_MYTHOS_ENABLED",
  "DEBUG_SQL",
  "E2E_PLAIN_PG",
  "NODE_ENV",
  "TTS_ENGINE",
  "VERCEL_ENV",
  // NB: `NICK_HIGH_SPEC_GATE` is also read raw in app/, but it IS registered,
  // so it does not belong here. I added it anyway on the first pass and the
  // shrink-only rule rejected it — the rule catching its author is the best
  // evidence it works, so this note stays instead of a silent deletion.
].sort();

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== "node_modules") walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * 2026-09-18 · `app/` is scanned too, added on review of PR #2425.
 *
 * The first version walked only `lib/`, which made the gate narrower than the
 * claim above it: a new raw switch in a route stayed invisible AND kept this
 * green. That is not hypothetical — the sweep immediately found two live ones
 * it had been blind to, `NICK_ESCALATION_DISABLED`
 * (app/api/ai/chat/route.ts:458) and `NICK_HIGH_SPEC_GATE`.
 *
 * Standing lesson, already in the agent memory as "a gate is only as wide as
 * its file list": assert the SUBJECT, not just the verdict. A ratchet that
 * scans the wrong tree reports a clean baseline forever.
 */
const SCAN_ROOTS = ["lib", "app"];

// A comment that describes a read is not a read (lib/feature-flags.ts has two).
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|\{\/\*)/;

/** Every NICK_* read, plus any switch-shaped read (=== / !== a string literal) under any name. */
function envReadsIn(src: string): string[] {
  const code = src.split("\n").filter((line) => !COMMENT_LINE.test(line)).join("\n");
  return [
    ...new Set([
      ...[...code.matchAll(/process\.env\.(NICK_[A-Z0-9_]+)/g)].map((m) => m[1]),
      ...[...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)\s*[!=]==\s*["'`]/g)].map((m) => m[1]),
    ]),
  ];
}

function rawEnvSwitches(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const files = SCAN_ROOTS.flatMap((r) => {
    try {
      return walk(join(APP_ROOT, r));
    } catch {
      return []; // root absent in this checkout
    }
  });
  for (const f of files) {
    const rel = f.slice(APP_ROOT.length + 1).replace(/\\/g, "/");
    for (const key of envReadsIn(readFileSync(f, "utf8"))) {
      const list = found.get(key) ?? [];
      if (!list.includes(rel)) list.push(rel);
      found.set(key, list);
    }
  }
  return found;
}

function registeredKeys(): Set<string> {
  const src = readFileSync(join(APP_ROOT, "lib/feature-flags.ts"), "utf8");
  return new Set([...src.matchAll(/key:\s*"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]));
}

describe("flag board visibility · a switch nobody can see cannot be reviewed", () => {
  it("positive control: the scanner actually finds raw env reads and registry keys", () => {
    // A zero from either side would make every assertion below vacuously pass.
    const reads = rawEnvSwitches();
    expect(reads.size, "found no process.env.NICK_* reads — scanner is broken").toBeGreaterThan(5);
    expect(registeredKeys().size, "found no FLAG_REGISTRY keys — scanner is broken").toBeGreaterThan(10);

    // EVERY scan root must contribute, or the gate silently narrows back to
    // whatever still resolves. `walk` swallows a missing root by design (other
    // checkouts), so without this a renamed/absent `app/` would return the
    // gate to exactly the blind spot review caught it in.
    for (const root of SCAN_ROOTS) {
      const fromRoot = [...reads.values()].flat().filter((p) => p.startsWith(`${root}/`));
      expect(fromRoot.length, `no NICK_* reads found under ${root}/ — is that root still being scanned?`).toBeGreaterThan(0);
    }
  });

  it("positive control: a planted non-NICK switch is flagged; a comment and a non-switch read are not", () => {
    const fixture = [
      'const live = process.env.FOO_LIVE === "1";',
      '// process.env.BAR_LIVE === "1" is only described here',
      "const url = process.env.DATABASE_URL;",
    ].join("\n");
    expect(envReadsIn(fixture)).toEqual(["FOO_LIVE"]);
  });

  it("the four switches mirrored by lib/feature-flags.ts predicates have ONE reader", () => {
    // PREDICATES in feature-flags-registry.test.ts proves the predicate agrees with
    // the board; that only means something if the runtime calls the predicate.
    const reads = rawEnvSwitches();
    for (const key of ["FEATURE_BULK_SMS_LIVE", "SEMANTIC_DEDUP_LIVE", "AGENT_BRIDGE_ENABLED", "NARRATOR_LLM_SYNTHESIS"]) {
      expect(reads.get(key), `${key} is read outside its predicate`).toEqual(["lib/feature-flags.ts"]);
    }
  });

  it("no NEW unregistered switch (the ratchet)", () => {
    const registered = registeredKeys();
    const unregistered = [...rawEnvSwitches()]
      .filter(([k]) => !registered.has(k))
      .map(([k, files]) => `${k}  (${files.join(", ")})`)
      .sort();
    const newlyUnregistered = unregistered.filter(
      (line) => !KNOWN_UNREGISTERED.some((k) => line.startsWith(k + " ")),
    );
    expect(
      newlyUnregistered,
      "a new switch is read from process.env but missing from FLAG_REGISTRY — add it to lib/feature-flags.ts so the flag board can show it",
    ).toEqual([]);
  });

  it("the baseline may only SHRINK — a registered key must leave the list", () => {
    const registered = registeredKeys();
    const staleBaseline = KNOWN_UNREGISTERED.filter((k) => registered.has(k));
    expect(
      staleBaseline,
      "these are registered now; delete them from KNOWN_UNREGISTERED so the ratchet keeps tightening",
    ).toEqual([]);
  });

  it("NICK_MEMORY_SUPERSESSION specifically is on the board (2026-09-18 regression)", () => {
    // The switch this test was written for: Wave 2's supersession half cannot
    // be given its shadow week while it is invisible.
    expect(registeredKeys().has("NICK_MEMORY_SUPERSESSION")).toBe(true);
  });
});
