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
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: { personProfile: { findMany: async () => db.rows } },
  resetQueryCount: () => {},
  getQueryCount: () => 0,
}));

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
  it("the selected person stays in the filtered list even when not sparse (the row the page scrolls to must exist)", () => {
    const rows = visiblePeopleRows(people, { needsInfoOnly: true, showAll: true, cap: 2, keepId: "a" });
    expect(rows.map((p) => p.id)).toEqual(["a", "b", "c", "e"]);
  });
  it("control: with the filter off the list is the whole list", () => {
    expect(visiblePeopleRows(people, { needsInfoOnly: false, showAll: true, cap: 2 })).toHaveLength(5);
  });
});

describe("People Needs info: the route's count and the page's list come from one predicate", () => {
  // The route is the consumer of isSparsePerson that PRINTS the count; the page filters with the
  // same function. A route that hand-rolled its own rule would pass the helper tests above.
  const row = (id: string, role: string, notes: string | null) => ({
    id,
    name: `n-${id}`,
    role,
    relationship: "r",
    trustScore: 0.5,
    leverageNotes: notes,
    lastInteraction: null,
    interactionCount: 0,
    ledger: [],
  });

  async function readTotals() {
    const { GET } = await import("@/app/api/people/route");
    const res = await GET(new Request("http://localhost/api/people") as never, { params: Promise.resolve({}) } as never);
    const body = await res.json();
    return body.data as { people: { id: string; role: string; leverageNotes: string | null }[]; totals: { sparse: number } };
  }

  it("totals.sparse equals the length of the list the Needs info filter shows", async () => {
    db.rows = [row("a", "client", "owes a favour"), row("b", "unknown", "has notes"), row("c", "client", null), row("d", "friend", "notes"), row("e", "friend", "")];
    const data = await readTotals();
    const shown = visiblePeopleRows(data.people, { needsInfoOnly: true, showAll: true, cap: 2 });
    expect(data.totals.sparse).toBe(3);
    expect(shown.map((p) => p.id)).toEqual(["b", "c", "e"]);
    expect(shown).toHaveLength(data.totals.sparse);
  });
  it("control: nobody sparse counts 0 and lists nobody", async () => {
    db.rows = [row("a", "client", "notes"), row("d", "friend", "notes")];
    const data = await readTotals();
    expect(data.totals.sparse).toBe(0);
    expect(visiblePeopleRows(data.people, { needsInfoOnly: true, showAll: true, cap: 2 })).toHaveLength(0);
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

  it("the cheatsheet lists no G P row, and still lists G S (the scan found the cheatsheet)", () => {
    const sheet = shortcuts.slice(shortcuts.indexOf("const SHORTCUTS"), shortcuts.indexOf("const GO_ROUTES"));
    expect(sheet).toContain('keys: ["G", "S"]');
    expect(sheet).not.toMatch(/keys:\s*\[\s*"G",\s*"P"\s*\]/);
  });

  it("View Recent Captures opens the journal feed (newest first), not the home page that has no captures list", () => {
    const palette = readFileSync("components/command-palette.tsx", "utf8");
    const row = palette.slice(palette.indexOf('id: "power-recent-captures"'));
    const target = /navigate\("([^"]+)"\)/.exec(row.slice(0, 400))?.[1];
    expect(target).toBe("/journal");
  });
});
