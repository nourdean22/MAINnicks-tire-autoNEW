/**
 * People W2: a cadence PROPOSAL per person (2026-10-30).
 *
 * 0 of 20 profiles have a cadence, so the neglect clock (W0) falls back to 14
 * days for everyone. The engine proposes one; Nour accepts or dismisses it in
 * the existing suggestion panel, and nothing is applied on its own.
 * Mechanism (manager's Perplexity run): Dex and Clay key a contact's clock to a
 * chosen interval; Dunbar layers are guidance, never quotas. So: his own
 * observed rhythm when the ledger has enough real contacts, else a role band.
 */
import { describe, expect, it } from "vitest";

import { suggestCadence } from "@/lib/services/people/cadence-suggest";

const d = (iso: string) => new Date(iso);

describe("suggestCadence", () => {
  it("3+ logged contacts: the median gap between them, from his own rhythm", () => {
    const out = suggestCadence({
      role: "friend",
      contacts: [d("2026-07-01"), d("2026-07-11"), d("2026-07-21"), d("2026-08-20")],
    });
    // gaps 10, 10, 30 -> median 10
    expect(out).toEqual({ days: 10, basis: "median gap between 4 logged contacts" });
  });

  it("order of the dates does not matter", () => {
    const out = suggestCadence({ role: "friend", contacts: [d("2026-08-20"), d("2026-07-01"), d("2026-07-21"), d("2026-07-11")] });
    expect(out?.days).toBe(10);
  });

  it("an observed rhythm is clamped to 3..180 days", () => {
    expect(suggestCadence({ role: "friend", contacts: [d("2026-07-01T08:00Z"), d("2026-07-01T09:00Z"), d("2026-07-01T10:00Z")] })?.days).toBe(3);
    expect(suggestCadence({ role: "friend", contacts: [d("2024-01-01"), d("2025-01-01"), d("2026-01-01")] })?.days).toBe(180);
  });

  it("fewer than 3 contacts: a role band, labelled as a default", () => {
    expect(suggestCadence({ role: "family", contacts: [] })).toEqual({ days: 7, basis: "default for family (inner circle)" });
    expect(suggestCadence({ role: "romantic", contacts: [d("2026-07-01")] })?.days).toBe(7);
    expect(suggestCadence({ role: "close_friend", contacts: [] })?.days).toBe(14);
    expect(suggestCadence({ role: "friend", contacts: [] })?.days).toBe(30);
    expect(suggestCadence({ role: "acquaintance", contacts: [] })?.days).toBe(90);
  });

  it("roles with no personal rhythm (work, adversarial, unknown) get no proposal", () => {
    for (const role of ["employee", "vendor", "customer", "enemy", "rival", "unknown", "Silent Business Partner"]) {
      expect(suggestCadence({ role, contacts: [] })).toBeNull();
    }
  });
});
