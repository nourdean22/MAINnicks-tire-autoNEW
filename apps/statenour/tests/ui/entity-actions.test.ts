/**
 * Entity actions · 2026-09-15.
 *
 * "Selection creates actions" — and only actions with a real destination
 * exist. Multi-selections get only multi-capable actions; hrefs name the
 * object by its wire id so Nick and the page can resolve it.
 */
import { describe, expect, it } from "vitest";
import { actionsFor, askNickPrompt, ENTITY_ACTIONS, homeRouteFor } from "@/lib/ui/entity-actions";

describe("actionsFor", () => {
  it("one object → every action; many → only the multi-capable ones", () => {
    const single = actionsFor([{ kind: "memory", id: "m1" }]).map((a) => a.id);
    expect(single).toEqual(["open", "ask-nick", "workset", "copy-link"]);
    const many = actionsFor([{ kind: "memory", id: "m1" }, { kind: "task", id: "t1" }]).map((a) => a.id);
    expect(many).toEqual(["ask-nick", "workset"]);
    expect(actionsFor([])).toEqual([]);
  });

  it("every registered action has a kind the row can run", () => {
    for (const a of ENTITY_ACTIONS) expect(["navigate", "chat", "workset", "copy-link"]).toContain(a.kind);
  });
});

describe("hrefs", () => {
  it("open goes to the owning page with the object addressed", () => {
    expect(homeRouteFor({ kind: "task", id: "t1" })).toBe("/missions?inspect=task:t1#task-t1");
    expect(homeRouteFor({ kind: "memory", id: "m1" })).toBe("/brain?tab=memory&inspect=memory:m1");
    expect(homeRouteFor({ kind: "person", id: "p1" })).toBe("/people?inspect=person:p1");
    expect(homeRouteFor({ kind: "decision", id: "d1" })).toBe("/decisions/d1");
    expect(homeRouteFor({ kind: "journal", id: "j1" })).toBe("/journal#bd-j1");
    expect(homeRouteFor({ kind: "pin", id: "p1" })).toBe("/pins#pin-p1");
    expect(homeRouteFor({ kind: "claim", id: "c1" })).toBe("/proof");
  });

  it("open is single-object only; ask-nick carries the wire ids in the prompt", () => {
    const open = ENTITY_ACTIONS.find((a) => a.id === "open")!;
    expect(open.href!([{ kind: "task", id: "t1" }, { kind: "task", id: "t2" }], {})).toBeNull();
    const ask = ENTITY_ACTIONS.find((a) => a.id === "ask-nick")!;
    const href = ask.href!([{ kind: "task", id: "t1" }], { labelOf: () => "Renew insurance" })!;
    expect(href.startsWith("/chat?prompt=")).toBe(true);
    const prompt = decodeURIComponent(href.slice("/chat?prompt=".length));
    expect(prompt).toContain("Renew insurance");
    expect(prompt).toContain("(task:t1)");
  });
});

describe("askNickPrompt", () => {
  it("falls back to '<kind> <id>' when no label is known, and lists many objects one per line", () => {
    expect(askNickPrompt([{ kind: "memory", id: "m1" }])).toContain('"memory m1"');
    const many = askNickPrompt([{ kind: "memory", id: "m1" }, { kind: "person", id: "p1" }], { labelOf: (r) => (r.kind === "person" ? "Mumu" : undefined) });
    expect(many).toContain("Compare these 2 objects");
    expect(many).toContain("- Mumu (person:p1)");
    expect(many).toContain("- memory m1 (memory:m1)");
    expect(askNickPrompt([])).toBe("");
  });
});
