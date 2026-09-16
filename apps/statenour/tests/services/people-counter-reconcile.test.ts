/**
 * counter-reconcile · the counters as a pure function of the ledger
 * (2026-09-16, W6). Pins the formula both the delete side and the reconcile
 * script use: count = contact rows, lastInteraction = newest contact row,
 * non-contact rows invisible to both.
 *
 * Positive control (run before trusting a green): mutate `isContactRow` to
 * `return true` — "a newer synthetic row never sets lastInteraction" and
 * "the 69-vs-4 shape" go red.
 */
import { describe, expect, it } from "vitest";

import {
  computeCounterDeltas,
  deriveCounters,
  type LedgerRowWithPerson,
  type ProfileCounters,
} from "@/lib/services/people/counter-reconcile";

const d = (iso: string) => new Date(iso);

describe("deriveCounters", () => {
  it("counts contact rows and takes the newest contact createdAt", () => {
    expect(
      deriveCounters([
        { createdAt: d("2026-06-01T14:16:48Z"), metadata: null },
        { createdAt: d("2026-06-04T01:13:03Z"), metadata: null },
        { createdAt: d("2026-06-03T01:25:26Z"), metadata: { via: "nick_action" } },
      ]),
    ).toEqual({ interactionCount: 3, lastInteraction: d("2026-06-04T01:13:03Z") });
  });

  it("no rows → 0 / null", () => {
    expect(deriveCounters([])).toEqual({ interactionCount: 0, lastInteraction: null });
  });

  it("a newer synthetic or status-flip row never sets lastInteraction and never counts", () => {
    expect(
      deriveCounters([
        { createdAt: d("2026-06-04T01:13:03Z"), metadata: null },
        { createdAt: d("2026-08-01T00:00:00Z"), metadata: { synthetic: true } },
        { createdAt: d("2026-09-01T00:00:00Z"), metadata: { kind: "status_flip", before: "active", after: "cooling" } },
      ]),
    ).toEqual({ interactionCount: 1, lastInteraction: d("2026-06-04T01:13:03Z") });
  });

  it("only non-contact rows → 0 / null, not the synthetic date", () => {
    expect(
      deriveCounters([{ createdAt: d("2026-05-04T21:04:09Z"), metadata: { synthetic: true } }]),
    ).toEqual({ interactionCount: 0, lastInteraction: null });
  });
});

describe("computeCounterDeltas", () => {
  const profiles: ProfileCounters[] = [
    // The prod shape: 69 counted, 4 real rows, 8 synthetic, lastInteraction from a mention bump.
    { id: "dania", name: "Dania", interactionCount: 69, lastInteraction: d("2026-09-12T15:13:55Z") },
    // Consistent already: must report changed:false and an identical after.
    { id: "nimeh", name: "Nimeh", interactionCount: 2, lastInteraction: d("2026-07-10T12:18:30Z") },
    // Count right, date wrong (a mention bump moved it).
    { id: "mash", name: "Mash", interactionCount: 1, lastInteraction: d("2026-09-11T19:07:42Z") },
    // No rows at all: derived to 0 / null.
    { id: "hamda", name: "Hamda", interactionCount: 18, lastInteraction: d("2026-09-09T03:06:46Z") },
  ];
  const rows: LedgerRowWithPerson[] = [
    { personId: "dania", createdAt: d("2026-05-04T21:04:09Z"), metadata: { synthetic: true } },
    { personId: "dania", createdAt: d("2026-05-09T15:27:28Z"), metadata: { synthetic: true } },
    { personId: "dania", createdAt: d("2026-06-01T14:16:48Z"), metadata: null },
    { personId: "dania", createdAt: d("2026-06-01T14:22:00Z"), metadata: null },
    { personId: "dania", createdAt: d("2026-06-03T01:25:26Z"), metadata: null },
    { personId: "dania", createdAt: d("2026-06-04T01:13:03Z"), metadata: null },
    { personId: "nimeh", createdAt: d("2026-06-01T14:35:36Z"), metadata: null },
    { personId: "nimeh", createdAt: d("2026-07-10T12:18:30Z"), metadata: null },
    { personId: "mash", createdAt: d("2026-06-06T18:58:11Z"), metadata: null },
  ];

  it("reports the 69-vs-4 shape, leaves a consistent profile unchanged, derives no-row profiles to 0 / null", () => {
    const out = computeCounterDeltas(profiles, rows);
    expect(out.map((x) => x.id)).toEqual(["dania", "nimeh", "mash", "hamda"]);

    expect(out[0]).toEqual({
      id: "dania",
      name: "Dania",
      before: { interactionCount: 69, lastInteraction: d("2026-09-12T15:13:55Z") },
      after: { interactionCount: 4, lastInteraction: d("2026-06-04T01:13:03Z") },
      changed: true,
    });
    expect(out[1].changed).toBe(false);
    expect(out[1].after).toEqual(out[1].before);
    expect(out[2]).toMatchObject({
      after: { interactionCount: 1, lastInteraction: d("2026-06-06T18:58:11Z") },
      changed: true,
    });
    expect(out[3]).toMatchObject({ after: { interactionCount: 0, lastInteraction: null }, changed: true });
  });

  it("is idempotent: applying the after-values and recomputing yields zero drift", () => {
    const first = computeCounterDeltas(profiles, rows);
    const applied: ProfileCounters[] = first.map((x) => ({ id: x.id, name: x.name, ...x.after }));
    const second = computeCounterDeltas(applied, rows);
    expect(second.filter((x) => x.changed)).toEqual([]);
  });
});
