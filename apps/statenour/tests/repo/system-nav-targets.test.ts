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

/**
 * 2026-08-28 · `features` and `hooks` ADDED. The sweep listed only app/lib/
 * config/components, so `/system/costs` — an href in
 * features/chat-v2/components/chat-capability-indicator.tsx pointing at a
 * segment that has an /api route but NO page — sat live and unseen while this
 * gate reported green. A gate is only as wide as its file list, and the
 * subject-coverage assertion below now pins that list so a future narrowing
 * fails loudly instead of silently un-seeing a directory.
 */
function sourceFiles(): string[] {
  return execFileSync("git", ["ls-files", "--", "app", "lib", "config", "components", "features", "hooks"], {
    encoding: "utf8",
    maxBuffer: 32e6,
  })
    .split("\n")
    .map((l) => l.trim())
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/**
 * NO DEFERRALS, and that is the whole change here.
 *
 * This block used to carry a five-entry KNOWN_DEAD list behind a reverse canary,
 * because where each link OUGHT to point was a product decision I had no
 * evidence for. The operator's answer: find the real destination, and where the
 * page genuinely does not exist REMOVE the link — a link to the wrong page is
 * worse than no link, and this is the class that had him tapping a push
 * notification into a page saying nothing existed.
 *
 * All five resolved, so the sweep below is unconditional:
 *
 *   /system/lens-stats   -> /system/health  · health renders it; health:389
 *                           even describes the click-through that never shipped
 *   /system/vapi-calls   -> /system/health  · health:435, same story
 *   /system/brain-bus    -> /system/fleet   · QueueRow name="brain-bus"
 *   /system/quality      -> REMOVED · QualityLessonsView has ZERO importers,
 *                           so there is no library page to open
 *   /system/eval-results -> REMOVED · no page, no /api/system/eval-results
 *                           route either, and use-observability.ts:69 records
 *                           that NO producer writes eval_result rows. The
 *                           drilldown would have opened on nothing.
 *
 * The reverse canary earned its keep on the way out: fixing the links turned its
 * own deferral list stale and it failed, naming the entries to delete. That is
 * the behaviour an exemption list can never have.
 */

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

  it("SUBJECT COVERAGE: the sweep actually reads every source directory, features included", () => {
    // The blind spot that let /system/costs ship: the file list omitted
    // `features`, so a whole slice of the chat UI was never swept. Assert the
    // SUBJECT, not just the verdict — a green sweep over the wrong file set is
    // the failure shape this repo keeps removing.
    const files = sourceFiles();
    for (const dir of ["app/", "lib/", "components/", "features/", "hooks/"]) {
      expect(
        files.some((f) => f.startsWith(dir)),
        `the nav sweep reads no files under ${dir} — it cannot see dead links there`,
      ).toBe(true);
    }
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
    const offenders = files.flatMap((f) =>
      brokenNavTargets(readFileSync(f, "utf8"), realPages).map((target) => `${f} -> ${target}`),
    );
    expect(
      offenders,
      "these link somewhere that does not exist. Either create the page, add a " +
        "next.config redirect, or repoint the link:\n  " + offenders.join("\n  "),
    ).toEqual([]);
  });
});
