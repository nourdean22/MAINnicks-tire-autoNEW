/**
 * Truth sweep 2026-10-23, acceptance 3: a control that writes or links something nobody reads is
 * wired or removed. Each case here stays red if the control goes dead again.
 *
 *  · Home "Keep" wrote a verdict only its own aria-pressed read. It now moves the kind up the brief
 *    (and keeps it above the "N more" fold) for the same seven days Less hides for.
 *  · People "Needs info" called the unfiltered revealBrowse(). It now filters to the people the
 *    count counted.
 *  · Cmd-K "View Recent Captures" opened `/`, which has no captures list.
 *  · Shortcut G P was a second door to /system, the same as G S.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { composeBriefRows } from "@/lib/home/brief-rows";
import { BRIEF_LESS_TTL_MS, keptKinds, type BriefFeedbackMap } from "@/lib/ui/brief-feedback";
import { isSparsePerson, visiblePeopleRows } from "@/lib/people/needs-info";
import { HOME_BRIEF } from "../e2e/fixtures/home";

const NOW = 1_800_000_000_000;

describe("keptKinds", () => {
  const map: BriefFeedbackMap = {
    commitment: { verdict: "keep", at: NOW - 1000 },
    followup: { verdict: "keep", at: NOW - BRIEF_LESS_TTL_MS - 1 },
    contradiction: { verdict: "less", at: NOW - 1000 },
  };
  it("lists a fresh Keep and nothing else", () => {
    expect(keptKinds(map, NOW)).toEqual(["commitment"]);
  });
  it("an expired Keep lapses, like an expired Less", () => {
    expect(keptKinds(map, NOW)).not.toContain("followup");
  });
});

describe("composeBriefRows with a kept kind", () => {
  const kinds = (cap: number, kept?: ReadonlySet<string>) =>
    composeBriefRows(HOME_BRIEF as never, new Set(), cap, kept).rows.map((r) => r.kind);

  it("control: with nothing kept the last kind in the brief is not second", () => {
    const all = kinds(99);
    expect(all[0]).toBe("lead");
    expect(all.indexOf("contradiction")).toBeGreaterThan(1);
  });
  it("a kept kind moves directly under the lead", () => {
    expect(kinds(99, new Set(["contradiction"]))[1]).toBe("contradiction");
  });
  it("a kept kind survives the fold that would have hidden it behind 'N more'", () => {
    const base = kinds(2);
    expect(base).not.toContain("contradiction");
    expect(kinds(2, new Set(["contradiction"]))).toContain("contradiction");
  });
  it("keeping a kind never drops or duplicates a row", () => {
    const plain = composeBriefRows(HOME_BRIEF as never, new Set(), 99);
    const kept = composeBriefRows(HOME_BRIEF as never, new Set(), 99, new Set(["followup"]));
    expect(kept.total).toBe(plain.total);
    expect(kept.rows.map((r) => r.key).sort()).toEqual(plain.rows.map((r) => r.key).sort());
  });
  it("a pinned lead stays first even when another kind is kept", () => {
    expect(kinds(99, new Set(["approval"]))[0]).toBe("lead");
  });
});

describe("People Needs info", () => {
  const person = (id: string, role: string, notes: string | null) => ({ id, role, leverageNotes: notes });
  const people = [
    person("a", "client", "owes a favour"),
    person("b", "unknown", "has notes"),
    person("c", "client", null),
    person("d", "friend", "notes"),
    person("e", "friend", ""),
  ];
  it("isSparsePerson is the rule the count uses: no notes, or role unknown", () => {
    expect(people.filter(isSparsePerson).map((p) => p.id)).toEqual(["b", "c", "e"]);
  });
  it("the filter shows exactly the people the count counted, past the cap when everything is revealed", () => {
    const rows = visiblePeopleRows(people, { needsInfoOnly: true, showAll: true, cap: 2 });
    expect(rows.map((p) => p.id)).toEqual(["b", "c", "e"]);
  });
  it("the cap still applies to the filtered list until revealed", () => {
    expect(visiblePeopleRows(people, { needsInfoOnly: true, showAll: false, cap: 2 })).toHaveLength(2);
  });
  it("control: with the filter off the list is the whole list", () => {
    expect(visiblePeopleRows(people, { needsInfoOnly: false, showAll: true, cap: 2 })).toHaveLength(5);
  });
});

describe("shortcuts and palette doors", () => {
  const shortcuts = readFileSync("components/hud/keyboard-shortcuts.tsx", "utf8");
  const routeBlock = shortcuts.slice(shortcuts.indexOf("const GO_ROUTES"), shortcuts.indexOf("export function KeyboardShortcuts"));
  const dests = [...routeBlock.matchAll(/^\s*([a-z]):\s*"([^"]+)"/gm)].map((m) => m[2]);
  const dupes = (xs: string[]) => [...new Set(xs.filter((x, i) => xs.indexOf(x) !== i))];

  it("POSITIVE CONTROL: the duplicate finder flags a repeat, and the scan sees the routes", () => {
    expect(dupes(["/a", "/b", "/a"])).toEqual(["/a"]);
    expect(dests.length).toBeGreaterThan(10);
  });
  it("no two G-chords share a destination", () => {
    expect(dupes(dests)).toEqual([]);
  });

  it("View Recent Captures opens the journal feed (newest first), not the home page that has no captures list", () => {
    const palette = readFileSync("components/command-palette.tsx", "utf8");
    const row = palette.slice(palette.indexOf('id: "power-recent-captures"'));
    const target = /navigate\("([^"]+)"\)/.exec(row.slice(0, 400))?.[1];
    expect(target).toBe("/journal");
  });
});
