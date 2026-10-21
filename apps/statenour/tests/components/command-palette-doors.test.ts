/**
 * ⌘K palette: every door opens somewhere real, once (audit 2026-10-10 ·
 * 02-F12, 10-U10).
 *
 * THE DEFECTS.
 *  - "Start Flow Mode" navigated to /chat?mode=flow. Nothing reads `mode`
 *    (use-chat-deep-link-prefill reads cid/conv/conversationId, q/seed/prompt,
 *    h), so it opened plain chat under a label promising a mode.
 *  - A chat-message search hit navigated to /chat#<messageId>. Nothing reads
 *    the hash, so it opened whatever conversation was current.
 *  - Duplicate doors: diag-hub / sys-health / power-diag-all all opened
 *    /system/health, diag-crons / sys-crons both opened /system/crons, and the
 *    id "sys-health" was used twice (a navigate entry and a probe), so the
 *    Recently Used lookup resolved one id to whichever came last.
 *
 * The action list lives inside the component's useMemo, so the door checks
 * read the source (the only place the list exists without a router) for the
 * hand-written rows, and add the System rows the palette builds from the hub
 * tiles (hubPaletteRows, UI v3 W5a). NAV rows are not added: "Talk to Nick" and
 * "View Recent Captures" are pre-existing second doors to /chat and / (not W5a's to fix).
 * `semanticHitHref` is the exported pure decision for search hits.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { semanticHitHref } from "@/components/command-palette";
import { hubPaletteRows } from "@/components/system/hub-cards";
import { NAV } from "@/components/layout/nav-items";

const src = readFileSync("components/command-palette.tsx", "utf8");

const navHrefs = NAV.flatMap((e) => [e.href, ...(e.tabs ?? []).map((t) => `${e.href}?tab=${encodeURIComponent(t.key)}`)]);
const hubRows = hubPaletteRows(new Set(navHrefs));
const literalIds = [...[...src.matchAll(/\bid:\s*"([^"]+)"/g)].map((m) => m[1]), ...hubRows.map((r) => r.id)];
const navigateTargets = [
  ...[...src.matchAll(/navigate\("([^"]+)"\)/g)].map((m) => m[1]),
  ...hubRows.map((r) => r.href),
];
const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

describe("command palette · doors", () => {
  it("the subject is real: the scan sees the action list", () => {
    expect(literalIds.length).toBeGreaterThan(20);
    // 14 after the 2026-10-19 wave 2V cut: seven of the hub rows (Fleet, Diagnostics, Errors, AI Cost, Logs,
    // State Calibration, Cockpit) left with their tiles; the literal navigate("...") targets did not change.
    expect(navigateTargets.length).toBeGreaterThan(12);
  });

  it("POSITIVE CONTROL: the duplicate finder flags a repeat", () => {
    expect(dupes(["a", "b", "a"])).toEqual(["a"]);
  });

  it("no action id is used twice", () => {
    expect(dupes(literalIds)).toEqual([]);
  });

  it("no destination has two doors", () => {
    expect(dupes(navigateTargets)).toEqual([]);
  });

  it("no door passes a param nothing reads (?mode=)", () => {
    expect(src).not.toMatch(/\/chat\?mode=/);
  });
});

describe("semanticHitHref · a search hit opens its own thread", () => {
  it("a chat message with its conversation opens that conversation via ?cid=", () => {
    expect(
      semanticHitHref({ id: "m1", sourceType: "chat_message", conversationId: "c 9" }, "q"),
    ).toBe("/chat?cid=c%209");
  });

  it("never a #hash anchor nothing reads", () => {
    const href = semanticHitHref({ id: "m1", sourceType: "chat_message", conversationId: "c1" }, "q");
    expect(href).not.toContain("#");
  });

  it("a chat message without a conversation id does not pretend to open it", () => {
    expect(semanticHitHref({ id: "m1", sourceType: "chat_message" }, "brake noise")).toBe(
      "/chat?prompt=brake%20noise",
    );
  });

  it("POSITIVE CONTROL: a memory hit still opens the memory inspector", () => {
    const href = semanticHitHref({ id: "mem1", sourceType: "brain_memory" }, "q");
    expect(href.startsWith("/brain?tab=memory")).toBe(true);
    expect(href).toContain("mem1");
  });
});
