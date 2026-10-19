/**
 * Every path to Meta must go through the door that holds the controls.
 *
 * WHAT WAS FOUND
 * `publishToSocial` accumulated three protections, each added by a different
 * wave, and each silently assuming all publishing flows through it:
 *   1. the autonomy kill switches (global / publishing / per-platform) + the
 *      DENY audit record,
 *   2. the content governor's daily cap and spacing,
 *   3. claim-safety on the caption (enforced by convention at every caller).
 *
 * Three surfaces reached postToInstagram / postToFacebook /
 * postInstagramCarousel directly and inherited none of them:
 *   - contentAdmin.publishCarousel (admin tRPC, no caller in the repo)
 *   - nickActions.socialPost    (admin tRPC, no caller in the repo)
 *   - igAutopost runIgAutopost  (AUTONOMOUS CRON — 116 live posts in prod)
 *
 * NOT A NEW CLASS. adStudioContainment.test.ts records the identical defect
 * being fixed for Ad Studio on 2026-07-25, naming the same three protections.
 * That fix repaired the surface in front of it and never swept the rest. The
 * structural test at the bottom of this file is the part that makes the sweep
 * stick — it is what would have caught all four at once.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("no new surface can reach Meta around the door", () => {
  const ROOT = join(new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), ".");

  const LOW_LEVEL = [
    "postInstagramCarousel", "postInstagramReel", "postInstagramStory",
    "postToInstagram", "postToFacebook", "socialPost",
  ];

  /**
   * Files permitted to import them, each for a stated reason. May only SHRINK.
   * Adding an entry means adding a publish path the emergency stop does not
   * cover — which is the whole defect this file exists to prevent.
   */
  const ALLOWED: Record<string, string> = {
    "services/socialPublish.ts":
      "IS the door. Holds the kill switch, the cadence governor, and the reel gate.",
    "services/igAutopost.ts":
      "Autonomous cron doing its own IG+FB dispatch. Cannot route through publishToSocial without also inheriting the feed cap — a live policy question — so it shares the emergency stop via killSwitchBlockedPlatforms instead. Pinned by the test below.",
  };

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "dist" || name === ".git") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) sourceFiles(p, acc);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) acc.push(p);
    }
    return acc;
  }

  const FILES = sourceFiles(ROOT)
    .filter((p) => !p.replace(/\\/g, "/").endsWith("services/metaSocial.ts")) // the definitions
    .map((p) => ({ rel: p.replace(/\\/g, "/").slice(ROOT.replace(/\\/g, "/").length).replace(/^\/+/, ""), src: readFileSync(p, "utf8") }));

  /**
   * Bindings pulled from metaSocial — static `import {} from` or dynamic
   * `const {} = await import()`.
   *
   * Review catch (P2). The first version claimed to handle static imports but
   * never consumed the `from` keyword, so it matched ONLY the dynamic form. It
   * looked correct and its anti-vacuity check passed, because every existing
   * caller happens to use `await import()`. A future
   * `import { postToInstagram } from "./services/metaSocial"` would have walked
   * straight through the sweep — creating precisely the ungated publish path
   * this test exists to reject. Both forms are now pinned directly below.
   */
  function metaSocialImports(src: string): string[] {
    const names: string[] = [];
    const re = /(?:import|const)\s*\{([^}]*)\}\s*(?:from\s*|=\s*await\s+import\(\s*)?["'][^"']*metaSocial["']/g;
    for (const m of src.matchAll(re)) {
      for (const raw of m[1].split(",")) {
        const n = raw.trim().split(/\s+as\s+/)[0].trim();
        if (n) names.push(n);
      }
    }
    return names;
  }

  it("the matcher catches BOTH import forms, not just the one in use today", () => {
    // The dynamic form is the only one any current caller uses, so a matcher
    // that handles only that form passes every other test in this file while
    // leaving the static door wide open.
    expect(metaSocialImports(`const { postToFacebook } = await import("./metaSocial");`))
      .toEqual(["postToFacebook"]);
    expect(metaSocialImports(`import { postToInstagram } from "./services/metaSocial";`))
      .toEqual(["postToInstagram"]);
    expect(metaSocialImports(`import { postToFacebook, postInstagramReel } from "../services/metaSocial";`))
      .toEqual(["postToFacebook", "postInstagramReel"]);
    // Renamed bindings still resolve to the real export.
    expect(metaSocialImports(`import { postToInstagram as go } from "./metaSocial";`))
      .toEqual(["postToInstagram"]);
    // A type-only import cannot publish anything, and must not be a false positive.
    expect(metaSocialImports(`import type { SomeType } from "./metaSocial";`)).toEqual([]);
    // Unrelated modules must not be swept in.
    expect(metaSocialImports(`import { publishToSocial } from "./socialPublish";`)).toEqual([]);
  });

  it("the scan actually sees source (an empty sweep would pass everything)", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some((f) => f.rel === "services/socialPublish.ts")).toBe(true);
    // The matcher must genuinely find the door's own imports, or it proves nothing.
    const door = FILES.find((f) => f.rel === "services/socialPublish.ts")!;
    expect(metaSocialImports(door.src)).toEqual(expect.arrayContaining(["postInstagramCarousel", "postToFacebook"]));
  });

  it("only the documented files import the low-level publishers", () => {
    const offenders = FILES
      .filter((f) => !(f.rel in ALLOWED))
      .map((f) => ({ rel: f.rel, hits: metaSocialImports(f.src).filter((n) => LOW_LEVEL.includes(n)) }))
      .filter((f) => f.hits.length);

    expect(
      offenders.map((o) => `${o.rel} -> ${o.hits.join(", ")}`),
      "These reach Meta around publishToSocial, so the operator's emergency stop " +
      "does not stop them and the daily cap does not count them. Route through " +
      "publishToSocial, or share the stop via killSwitchBlockedPlatforms.",
    ).toEqual([]);
  });

  it("the allowlist has no stale entries — it may only SHRINK", () => {
    const stale = Object.keys(ALLOWED).filter((rel) => {
      const f = FILES.find((x) => x.rel === rel);
      return !f || !metaSocialImports(f.src).some((n) => LOW_LEVEL.includes(n));
    });
    expect(stale, `no longer needed; remove from ALLOWED: ${stale.join(", ")}`).toEqual([]);
  });

  it("igAutopost is allowlisted ONLY because it honours the stop itself", () => {
    // Strip the guard while keeping the direct posts and this fails — which is
    // the exact regression the allowlist would otherwise licence.
    const f = FILES.find((x) => x.rel === "services/igAutopost.ts")!;
    expect(f.src).toMatch(/killSwitchBlockedPlatforms\(\s*\[\s*["']instagram["']\s*,\s*["']facebook["']\s*\]/);
    // and it must actually branch on the answer, not just call it
    expect(f.src).toMatch(/igBlocked\s*&&\s*fbBlocked/);
    // and it must claim the AUTOMATED actor, which is what makes an unreadable
    // switch state stop the cron instead of letting it publish blind.
    expect(f.src).toMatch(/killSwitchBlockedPlatforms\([\s\S]{0,200}["']automated["']/);
  });
});
