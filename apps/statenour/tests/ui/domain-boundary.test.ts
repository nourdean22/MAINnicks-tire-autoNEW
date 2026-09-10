/**
 * tests/ui/domain-boundary.test.ts · 2026-09-10
 *
 * Compiles a rule the repo already states in prose into something CI can
 * check.
 *
 * The rule, in the operator's own words, quoted in
 * app/(mastery)/stats/page.tsx:20 — "business shit belongs on nicks tire
 * admin." StateNour owns Nour: personal goals, learning, decisions,
 * relationships, personal brand, owner approvals, cross-business
 * judgment. The shop — its customers, content, campaigns, outreach,
 * photos, revenue, operations — lives at nickstire.org/admin. Shop data
 * may ENTER StateNour when Nour's personal judgment is required; shop
 * FUNCTIONALITY should not live here.
 *
 * WHAT THIS DOES NOT DO. A naive grep for "Nick's Tire" across the
 * StateNour UI returns nine files and would be wrong about six of them.
 * Three distinct things look identical to a text search:
 *
 *   1. a COMMENT stating the boundary rule (stats/page.tsx:20,
 *      home-console.tsx:25) — that is the rule, not a violation;
 *   2. an HREF to nickstire.org/admin (deck-lanes.tsx:74,
 *      tool-result-registry.tsx:785) — linking out is exactly right;
 *   3. shop FUNCTIONALITY or shop-voiced COPY living in StateNour —
 *      the actual leak.
 *
 * A gate that cannot tell those apart would fire on the file that
 * documents the rule. So comments and links are excluded, and the
 * remaining hits are frozen below with a per-file judgement.
 *
 * The allowlist is a LEDGER, not an amnesty: it exists so that new leaks
 * fail while the existing ones stay visible and attributable. Moving a
 * feature between apps is a two-deploy change and an operator decision;
 * this gate's job is to stop the list growing while that decision is
 * pending.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
/**
 * PRODUCT SURFACES only.
 *
 * `app/api/**` is deliberately excluded: that is the BRIDGE, and
 * StateNour talking to nickstire over it is the architecture working as
 * designed (read-only via queryNick + the bridge, per the app's own
 * AGENTS.md). The first run of this gate included it and flagged
 * app/api/sync/business, app/api/telegram/webhook and others — all of
 * which are correct. The rule constrains where shop FEATURES live, not
 * whether the two systems may talk.
 */
const ROOTS = ["app", "components", "features"];
const EXCLUDED_PREFIXES = ["app/api/"];

/** Shop-specific identity. Deliberately narrow. */
const SHOP_IDENTITY = /nick['’]?s\s+tire|nickstire\.org/i;

/**
 * Known shop-domain surfaces in StateNour, each with a judgement.
 * Adding a NEW key here should require the same argument these did.
 */
const KNOWN: Record<string, string> = {
  "app/(mastery)/photo-improver/page.tsx":
    "LEAK · shop photo pipeline producing a Nick's Tire branded re-render. Belongs in the shop admin. Moving it is a two-deploy change; pending operator decision.",
  "components/content/outreach-tab.tsx":
    "LEAK · customer outreach templates written in the shop's voice. Shop customer contact belongs in the shop admin.",
  "app/(mastery)/system/camera/page.tsx":
    "BORDERLINE · shop branding on a camera surface. The camera SYSTEM is arguably shared infrastructure; the branding is not. Left as-is pending the camera-domain decision.",
  "components/stats/calibration-section.tsx":
    "LEGITIMATE · labels cross-domain business metrics feeding Nour's personal calibration. The rule explicitly permits shop DATA entering StateNour when personal judgement is required.",
};

function tsxFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) tsxFiles(full, acc);
    else if (entry.endsWith(".tsx") || entry.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

/** Strip comments, preserving line count so nothing else shifts. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""))
    .replace(/\/\/[^\n]*/g, "");
}

/** A line that merely LINKS to the shop admin is correct, not a leak. */
function isLinkOut(line: string): boolean {
  return /href\s*[:=]/.test(line) || /https?:\/\/(www\.)?nickstire\.org/.test(line);
}

/**
 * Repo-relative, forward-slashed, so one spelling of a path is used
 * everywhere: the KNOWN keys, the exclusion prefixes and the failure
 * message all have to agree, and on Windows `join` hands back
 * backslashes. Split on `sep` rather than a regex — a backslash inside a
 * character class is the single most mangled token in this toolchain.
 */
function relPath(abs: string): string {
  return abs.slice(APP_ROOT.length + 1).split(sep).join("/");
}

const FILES = ROOTS.flatMap((r) => {
  try {
    return tsxFiles(join(APP_ROOT, r));
  } catch {
    return [];
  }
}).filter((f) => !EXCLUDED_PREFIXES.some((p) => relPath(f).startsWith(p)));

function offendingFiles(): string[] {
  const out = new Set<string>();
  for (const f of FILES) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    if (lines.some((l) => SHOP_IDENTITY.test(l) && !isLinkOut(l))) {
      out.add(relPath(f));
    }
  }
  return [...out].sort();
}

describe("StateNour does not grow new shop-domain surfaces", () => {
  // POSITIVE CONTROL. With no files scanned everything passes vacuously.
  it("POSITIVE CONTROL · the scan sees the UI tree", () => {
    expect(FILES.length).toBeGreaterThan(50);
  });

  /**
   * The exclusion NARROWS the gate, so it needs its own proof that it
   * narrowed only what it claimed. Two halves, and the second is the one
   * that matters: excluding a path that does not exist would pass the
   * first half forever while silently protecting nothing.
   */
  it("POSITIVE CONTROL · the bridge is excluded, and there was a bridge to exclude", () => {
    expect(FILES.filter((f) => relPath(f).startsWith("app/api/"))).toEqual([]);
    const apiFiles = tsxFiles(join(APP_ROOT, "app", "api"));
    expect(apiFiles.length).toBeGreaterThan(0);
    // ...and the exclusion is doing work: the bridge really does name the
    // shop, which is why the unscoped first run of this gate flagged it.
    const bridgeHits = apiFiles.filter((f) =>
      stripComments(readFileSync(f, "utf8"))
        .split("\n")
        .some((l) => SHOP_IDENTITY.test(l) && !isLinkOut(l)),
    );
    expect(bridgeHits.length).toBeGreaterThan(0);
  });

  it("POSITIVE CONTROL · the detector distinguishes the three cases", () => {
    // A rule-stating comment is stripped before matching.
    expect(stripComments("// shop surfaces live at nickstire.org/admin").trim()).toBe("");
    // A link out is not a leak.
    expect(isLinkOut('href="https://nickstire.org/admin"')).toBe(true);
    // Shop-voiced copy is.
    expect(SHOP_IDENTITY.test("Nour here from Nick's Tire & Auto")).toBe(true);
    expect(isLinkOut("Nour here from Nick's Tire & Auto")).toBe(false);
  });

  it("no NEW shop-domain surface has appeared in StateNour", () => {
    const unexpected = offendingFiles().filter((f) => !(f in KNOWN));
    expect(
      unexpected,
      "A StateNour surface now carries shop-specific functionality or shop-voiced copy. " +
        "StateNour owns Nour (personal goals, decisions, relationships, owner approvals, " +
        "cross-business judgement); the shop's customers, content, campaigns, outreach and " +
        "photos belong at nickstire.org/admin. If this is genuinely cross-domain data " +
        "entering for Nour's personal judgement, add it to KNOWN with that argument.",
    ).toEqual([]);
  });

  // INVERSE CHECK: a ledger entry whose file no longer offends is stale.
  // Without this the list silently becomes an amnesty nobody re-reads —
  // and the whole point is that it stays attributable.
  it("every ledger entry still describes a real occurrence", () => {
    const current = new Set(offendingFiles());
    const stale = Object.keys(KNOWN).filter((f) => !current.has(f));
    expect(
      stale,
      "These files are recorded as shop-domain surfaces but no longer match. If the feature " +
        "moved to the shop admin, delete the entry — do not leave it as cover for a future one.",
    ).toEqual([]);
  });
});
