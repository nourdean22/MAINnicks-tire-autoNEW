/**
 * A link the operator can click must go somewhere that exists.
 *
 * THE DEFECT. `/system/approvals` was absorbed into `/system/actions` — README
 * line 92 records the move — but SIXTEEN references were left behind across
 * eleven files. Six of them were live operator-facing strings, and three of
 * those go out over Telegram with an auto-linked `bdnick.info/system/approvals`:
 *
 *   nick-action-proposal   "Queue: bdnick.info/system/approvals"
 *   nick-action-batch      "Audit: bdnick.info/system/approvals"
 *   nick-action-execute    "Approved actions stay pending · /system/approvals
 *                           shows them"
 *   autonomous-engine      "Side effect held; approve via /system/approvals to
 *                           execute."
 *
 * The engine defers a real side effect and then tells the operator where to go
 * and approve it. That destination has been a 404. There is no redirect —
 * next.config's list covers /dashboard, /habits, /tasks, /plan, /mastery, /nick
 * and /knowledge, and none of them is a /system path.
 *
 * WHY THE RULE IS THIS NARROW. A first draft matched every `/system/<seg>` in
 * the source and reported 100+ breakages — because it also matched
 * `@/components/system/hub-grid` import paths and `withSurface("system/…")`
 * logger names. A gate wider than its invariant is unshippable, so it grows an
 * exemption list, and an exemption list is how a gate becomes decoration.
 *
 * Two forms are unambiguously NAVIGATION and nothing else: `href="/system/…"`
 * and a `bdnick.info/system/…` URL. That is exactly as wide as the invariant,
 * needs no exemptions, and is what this asserts. Measured: 18 such targets.
 */
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

/** Only the two forms that can only mean "go here". */
const NAV = /(?:href=["'`]|bdnick\.info)(\/system\/([a-z0-9-]+))/g;

function brokenNavTargets(src: string, realPages: Set<string>): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(NAV)) {
    if (!realPages.has(m[2])) out.push(m[1]);
  }
  return out;
}

function realSystemPages(): Set<string> {
  return new Set(readdirSync("app/(mastery)/system"));
}

function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "app", "lib", "config", "components"], {
    encoding: "utf8",
    maxBuffer: 32e6,
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/**
 * Live dead links this change did not create and cannot responsibly fix: where
 * `/system/lens-stats` OUGHT to point is a product decision, and guessing a
 * destination is worse than naming the breakage.
 *
 * Deferred WITH A REVERSE CANARY (below) that asserts each entry is still
 * broken. Fix one and the test fails, telling you to delete the line — so this
 * list cannot outlive its reason the way a plain exemption list does.
 */
const KNOWN_DEAD: Record<string, string> = {
  "/system/quality": "app/(mastery)/decisions/[id]/page.tsx — href=/system/quality?view=lessons",
  "/system/lens-stats": "components/actions/daily-brief-section.tsx",
  "/system/vapi-calls": "components/actions/daily-brief-section.tsx",
  "/system/brain-bus": "components/mastery/bridge-shell.tsx — also rendered as visible link TEXT",
  "/system/eval-results": "components/ultron/observability/eval-pass-rate-tile.tsx",
};

describe("system nav targets · a clickable link must resolve", () => {
  const pages = () => realSystemPages();

  it("POSITIVE CONTROL: it catches a dead href and a dead Telegram URL", () => {
    // Synthetic, owned by this test. `/system/approvals` is the real one that
    // shipped — sixteen references to a page that does not exist.
    const real = new Set(["actions", "health"]);
    expect(brokenNavTargets('<a href="/system/approvals">queue</a>', real)).toEqual([
      "/system/approvals",
    ]);
    expect(brokenNavTargets("`Queue: bdnick.info/system/approvals`", real)).toEqual([
      "/system/approvals",
    ]);
  });

  it("NEGATIVE CONTROL: it ignores imports and logger surfaces, and accepts real pages", () => {
    // The false positives that made the first draft of this rule unshippable.
    const real = new Set(["actions", "health"]);
    expect(brokenNavTargets('import { HubGrid } from "@/components/system/hub-grid";', real)).toEqual([]);
    expect(brokenNavTargets('rootLogger.withSurface("system/observability")', real)).toEqual([]);
    expect(brokenNavTargets('const r = await fetch("/api/system/cockpit");', real)).toEqual([]);
    expect(brokenNavTargets('<a href="/system/actions">approvals</a>', real)).toEqual([]);
  });

  it("the page list is real — otherwise every check here is vacuous", () => {
    // Without this, a readdir returning [] would make "every link is broken"
    // and mask the sweep entirely.
    expect(pages().size).toBeGreaterThan(5);
    expect(pages().has("actions")).toBe(true);
  });

  it("no navigation target points at a page that does not exist", () => {
    const realPages = pages();
    const files = sourceFiles();
    expect(files.length, "git ls-files returned nothing — the sweep had no subject").toBeGreaterThan(100);
    const offenders = files.flatMap((f) => {
      const bad = brokenNavTargets(readFileSync(f, "utf8"), realPages).filter(
        (t) => !(t in KNOWN_DEAD),
      );
      return bad.map((t) => `${f} -> ${t}`);
    });
    expect(
      offenders,
      "these link somewhere that does not exist. Either create the page, add a " +
        "next.config redirect, or repoint the link:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });

  it("REVERSE CANARY: every KNOWN_DEAD entry is still actually dead", () => {
    // Fails when one gets fixed (or the page gets created), naming the entry to
    // delete. Without this the five below quietly become permanent.
    const realPages = pages();
    const stillDead = new Set(
      sourceFiles().flatMap((f) => brokenNavTargets(readFileSync(f, "utf8"), realPages)),
    );
    const resolved = Object.keys(KNOWN_DEAD).filter((t) => !stillDead.has(t));
    expect(
      resolved,
      "these are no longer dead — remove them from KNOWN_DEAD above:\n  " + resolved.join("\n  "),
    ).toEqual([]);
  });
});
