/**
 * tests/services/nick-suggestions-failed-reads.test.ts - honest-reads leftovers 2026-10-25.
 *
 * buildNickSuggestions caught every one of its eleven source reads to []/null/empty, so
 * `nick.suggestions` could never error: a database outage returned `{ suggestions: [] }` and the chip
 * strip hid it as a quiet morning (empty-vs-error). The component already renders an error state
 * (components/chat/nick-suggestions.tsx); it only needs the service to fail. Pinned here at the
 * SERVICE, because a test that mocks the query cannot see a service-level catch:
 *   - every read failing throws, so the query errors;
 *   - one read answering keeps its chip (a partial failure is still a partial answer);
 *   - every read succeeding with nothing is a real quiet morning and resolves empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  mode: "all-fail" as "all-fail" | "all-fail-leads-reject" | "one-answers" | "all-empty",
  recordShownBounded: vi.fn(async () => null),
  demo: false,
}));

const reject = () => Promise.reject(new Error("db down"));

vi.mock("@/lib/prisma", () => {
  const answer = (model: string, op: string) => {
    if (h.mode === "all-fail" || h.mode === "all-fail-leads-reject") return reject();
    if (h.mode === "all-empty") return Promise.resolve(op === "findFirst" ? null : []);
    // one-answers: only the mastery read answers; everything else rejects.
    if (model === "masteryScore") return Promise.resolve([{ domain: "body", score: 20, delta: 0, date: "2026-10-25" }]);
    return reject();
  };
  const model = (name: string) =>
    new Proxy({}, { get: (_t, op: string) => () => answer(name, op) });
  return { prisma: new Proxy({}, { get: (_t, name: string) => model(name) }) };
});
// isDemoMode is a module constant in production; a getter lets each test pick the mode.
vi.mock("@/lib/runtime", () => ({
  get isDemoMode() {
    return h.demo;
  },
}));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: h.recordShownBounded }));
vi.mock("@/lib/brain/suggestion-loop", () => ({
  getDismissedSuggestionIds: async () =>
    h.mode === "all-fail" || h.mode === "all-fail-leads-reject" ? Promise.reject(new Error("db down")) : new Set<string>(),
}));
vi.mock("@/lib/services/leads", () => ({
  // Production shape: with the lead bridge missing, listLeads() never rejects; it logs and resolves [].
  // Only "all-fail-leads-reject" makes it reject, to prove a rejecting lead read cannot break the quorum.
  getUrgentLeads: async () => (h.mode === "all-fail-leads-reject" ? Promise.reject(new Error("db down")) : []),
}));

import { buildNickSuggestions } from "@/lib/services/nick-suggestions";

beforeEach(() => {
  h.recordShownBounded.mockClear();
  h.demo = false;
});

describe("buildNickSuggestions: a total failure is an error, not a quiet morning", () => {
  it("throws when every database read failed even though the lead read resolves [] as in production", async () => {
    h.mode = "all-fail";
    await expect(buildNickSuggestions()).rejects.toThrow(/every suggestion source/i);
  });

  it("still throws when the lead read rejects too (it does not vote either way)", async () => {
    h.mode = "all-fail-leads-reject";
    await expect(buildNickSuggestions()).rejects.toThrow(/every suggestion source/i);
  });

  it("demo mode (no database): every Prisma read rejects by design, so the strip stays empty, not an error", async () => {
    h.mode = "all-fail";
    h.demo = true;
    const view = await buildNickSuggestions();
    expect(view.suggestions).toEqual([]);
  });

  it("CONTROL: the same total failure outside demo mode still throws", async () => {
    h.mode = "all-fail";
    h.demo = false;
    await expect(buildNickSuggestions()).rejects.toThrow(/every suggestion source/i);
  });

  it("CONTROL: one read answering keeps its chip (a partial failure is a partial answer)", async () => {
    h.mode = "one-answers";
    const view = await buildNickSuggestions();
    expect(view.suggestions.map((s) => s.kind)).toEqual(["weak-axis"]);
  });

  it("CONTROL: every read succeeding with nothing is a real quiet morning and resolves empty", async () => {
    h.mode = "all-empty";
    const view = await buildNickSuggestions();
    expect(view.suggestions).toEqual([]);
  });
});
