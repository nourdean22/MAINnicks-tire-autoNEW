/**
 * The wisdom origin registry has exactly one copy, and resolving an
 * origin agrees with labelling it.
 *
 * THE DEFECT (2026-09-02 self-audit, #5). The registry existed in FOUR
 * copies and two had drifted. Resolution lived in
 * `lib/services/brain-wisdom.ts` (metadata.origin + 5 key prefixes),
 * `app/api/brain/wisdom/[id]/related/route.ts` (8 prefixes, no
 * metadata, no `nick_advice_`) and `lib/brain/wisdom-violations.ts`
 * (byte-identical third copy). Labelling lived in `wisdom-tab.tsx`
 * (`ORIGIN_META`, 10 keys) and `related-wisdom-links.tsx`
 * (`ORIGIN_BADGE`, 9 keys — no `chat-scrape`). Result: one principle
 * labelled "Chat scrape · Raw assistant output" in the main list and
 * "uncategorized" in the see-also list, on the same screen.
 *
 * WHY THE REPO SCAN BELOW IS THE LOAD-BEARING TEST. Asserting today's
 * values ("chat-scrape maps to Chat") would have passed happily on the
 * broken code — every copy was internally consistent; they just
 * disagreed with each other. So the canary that matters asserts the
 * SHAPE: no second declaration exists anywhere under lib/ app/
 * components/. Re-add one and this goes red, which is the failure the
 * four-copy era never produced.
 *
 * Comment-stripping is not optional. Four of the five former sites now
 * carry an explanatory comment naming the origins they used to hold —
 * an un-stripped scan would fire on this fix's own prose. There is a
 * positive control for the stripper below for exactly that reason.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WISDOM_ORIGINS,
  WISDOM_ORIGIN_KEY_PREFIXES,
  WISDOM_ORIGIN_ORDER,
  resolveWisdomOrigin,
  wisdomOriginMeta,
  type WisdomOrigin,
} from "@/lib/brain/wisdom-origins";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCAN_DIRS = ["lib", "app", "components"];
const REGISTRY_FILE = "lib/brain/wisdom-origins.ts";

/** The one place a wisdom-origin registry may be declared. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
}

/**
 * A file declaring a wisdom-origin registry names both a curated origin
 * and the catch-all in the same file. `lib/ai/board/boards.ts` carries
 * "steve-jobs" as a board-member id and is correctly NOT matched — it
 * has no "uncategorized".
 */
function declaresOriginRegistry(src: string): boolean {
  const code = stripComments(src);
  return code.includes("steve-jobs") && code.includes("uncategorized");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(full);
  }
  return out;
}

describe("the divergence detector itself", () => {
  it("FIRES on a second registry declaration", () => {
    // The positive control. Without it every "clean" verdict below is
    // vacuous — a detector that never fires passes any codebase.
    const duplicate = [
      'const ORIGIN_BADGE: Record<string, string> = {',
      '  "steve-jobs": "Jobs",',
      '  "uncategorized": "Wisdom",',
      '};',
    ].join("\n");
    expect(declaresOriginRegistry(duplicate)).toBe(true);
  });

  it("does NOT fire on a comment that merely names the origins", () => {
    // The trap this repo has hit twice: an assertion on source text that
    // matches the explanatory comment written beside the fix.
    const commentOnly = [
      "// ORIGIN_BADGE used to live here with steve-jobs and uncategorized;",
      "/* deleted 2026-09-02 · see lib/brain/wisdom-origins.ts */",
      'import { wisdomOriginMeta } from "@/lib/brain/wisdom-origins";',
    ].join("\n");
    expect(declaresOriginRegistry(commentOnly)).toBe(false);
  });

  it("does NOT fire on a curated name used for something else", () => {
    // lib/ai/board/boards.ts shape · a board roster, not an origin registry.
    const boardRoster = 'const MEMBERS = ["steve-jobs", "warren-buffett"];';
    expect(declaresOriginRegistry(boardRoster)).toBe(false);
  });
});

describe("exactly one wisdom-origin registry in the tree", () => {
  it("no file outside the registry declares one", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(APP_ROOT, dir))) {
        const rel = relative(APP_ROOT, file).split(/[\\/]/).join("/");
        if (rel === REGISTRY_FILE) continue;
        if (declaresOriginRegistry(readFileSync(file, "utf8"))) offenders.push(rel);
      }
    }
    expect(
      offenders,
      `these files declare a second wisdom-origin registry · import from ${REGISTRY_FILE} instead`,
    ).toEqual([]);
  });

  it("and the registry file really is one (the instrument saw its target)", () => {
    const src = readFileSync(join(APP_ROOT, REGISTRY_FILE), "utf8");
    expect(declaresOriginRegistry(src)).toBe(true);
  });
});

describe("resolveWisdomOrigin · the union of the three deleted copies", () => {
  it("prefers metadata.origin over the key prefix", () => {
    expect(resolveWisdomOrigin("wisdom_jobs_focus", "greene-laws")).toBe("greene-laws");
  });

  it("passes an unregistered metadata.origin through verbatim", () => {
    // A new seeder that ships before its label must surface as itself,
    // not be flattened into the catch-all.
    expect(resolveWisdomOrigin("wisdom_x_1", "naval-ravikant")).toBe("naval-ravikant");
  });

  it.each(WISDOM_ORIGIN_KEY_PREFIXES)("maps %s to %s", (prefix, origin) => {
    expect(resolveWisdomOrigin(`${prefix}abc`, null)).toBe(origin);
  });

  it("resolves nick_advice_ to chat-scrape — the case two copies dropped", () => {
    // This is the exact divergence: the service copy had it, the route
    // and violations copies did not, so one row read "Chat scrape" in
    // one list and "uncategorized" in another.
    expect(resolveWisdomOrigin("nick_advice_cm123", null)).toBe("chat-scrape");
  });

  it("resolves the four prefixes the service copy was missing", () => {
    expect(resolveWisdomOrigin("wisdom_buffett_moat", null)).toBe("warren-buffett");
    expect(resolveWisdomOrigin("wisdom_gates_scale", null)).toBe("bill-gates");
    expect(resolveWisdomOrigin("wisdom_musk_delete", null)).toBe("elon-musk");
    expect(resolveWisdomOrigin("wisdom_greene_law_1", null)).toBe("greene-laws");
  });

  it("falls back to uncategorized on an unknown key with no metadata", () => {
    expect(resolveWisdomOrigin("legacy_row_42", null)).toBe("uncategorized");
    expect(resolveWisdomOrigin("legacy_row_42", "")).toBe("uncategorized");
  });
});

describe("every resolvable origin is labellable", () => {
  it("each key prefix resolves to an origin that has a registry entry", () => {
    for (const [, origin] of WISDOM_ORIGIN_KEY_PREFIXES) {
      expect(WISDOM_ORIGINS[origin], `no label for ${origin}`).toBeDefined();
    }
  });

  it("every registry entry has a non-empty label and badge", () => {
    for (const [origin, meta] of Object.entries(WISDOM_ORIGINS)) {
      expect(meta.label.length, origin).toBeGreaterThan(0);
      expect(meta.badge.length, origin).toBeGreaterThan(0);
    }
  });

  it("chat-scrape is labelled — the key ORIGIN_BADGE omitted", () => {
    expect(wisdomOriginMeta("chat-scrape").badge).not.toBe("chat-scrape");
    expect(wisdomOriginMeta("chat-scrape").label).toBe("Chat scrape");
  });

  it("render order covers every registry key exactly once", () => {
    expect([...WISDOM_ORIGIN_ORDER].sort()).toEqual(
      (Object.keys(WISDOM_ORIGINS) as WisdomOrigin[]).sort(),
    );
    expect(new Set(WISDOM_ORIGIN_ORDER).size).toBe(WISDOM_ORIGIN_ORDER.length);
  });

  it("an unknown origin renders as itself rather than blanking the row", () => {
    const meta = wisdomOriginMeta("naval-ravikant");
    expect(meta.label).toBe("naval-ravikant");
    expect(meta.badge).toBe("naval-ravikant");
  });
});
