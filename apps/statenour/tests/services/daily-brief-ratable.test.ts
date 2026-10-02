/**
 * The daily brief must be RATEABLE from the surface it actually arrives on.
 *
 * WHY. `recordShown` had 24 callers and `recordOutcome` had two, so every
 * proactive_push and daily_brief row was structurally unlabelable. #2424 fixed
 * the proactive_push half with Telegram buttons — and left the brief, because
 * the brief's PRIMARY surface is WEB PUSH. Measured: ~90 daily_brief rows in
 * intelligence_outcomes, zero labels. Not operator neglect; nothing anywhere
 * could express a verdict on them.
 *
 * ★ An outcome ledger with a writer and no rater measures delivery, not
 *   usefulness. These pin the affordance, not a reminder.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const m = vi.hoisted(() => ({
  requireSession: vi.fn(),
  recordOutcome: vi.fn(),
}));

vi.mock("@/lib/auth-guard", () => ({ requireSession: m.requireSession }));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordOutcome: m.recordOutcome }));

import { POST } from "@/app/api/outcomes/rate/route";

const post = (body: unknown) =>
  POST(
    new Request("http://x/api/outcomes/rate", {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  m.requireSession.mockResolvedValue({ ok: true });
  m.recordOutcome.mockResolvedValue(true);
});

describe("POST /api/outcomes/rate", () => {
  it("records a verdict against the ledger row", async () => {
    const res = await post({ id: "led-1", useful: true });
    expect(await res.json()).toMatchObject({ ok: true, recorded: true });
    expect(m.recordOutcome).toHaveBeenCalledWith({ id: "led-1", useful: true });
  });

  it("records a NEGATIVE verdict as false, not as absence", async () => {
    await post({ id: "led-1", useful: false });
    expect(m.recordOutcome).toHaveBeenCalledWith({ id: "led-1", useful: false });
  });

  it("REFUSES a missing verdict rather than defaulting to useful", async () => {
    // Defaulting would manufacture a label the operator never gave, and every
    // rate computed from this table would inherit it.
    const res = await post({ id: "led-1" });
    expect(res.status).toBe(400);
    expect(m.recordOutcome).not.toHaveBeenCalled();
  });

  it("refuses a non-boolean verdict", async () => {
    const res = await post({ id: "led-1", useful: "yes" });
    expect(res.status).toBe(400);
    expect(m.recordOutcome).not.toHaveBeenCalled();
  });

  it("refuses a missing id", async () => {
    const res = await post({ useful: true });
    expect(res.status).toBe(400);
    expect(m.recordOutcome).not.toHaveBeenCalled();
  });

  it("reports a second tap as alreadyRated, not as failure", async () => {
    // recordOutcome only updates rows with outcomeAt:null, so re-tapping must
    // not read as an error — nor overwrite the first verdict.
    m.recordOutcome.mockResolvedValue(false);
    const res = await post({ id: "led-1", useful: true });
    expect(await res.json()).toMatchObject({ ok: true, recorded: false, alreadyRated: true });
  });

  it("is session-gated", async () => {
    m.requireSession.mockRejectedValue(new Error("unauthorized"));
    await expect(post({ id: "led-1", useful: true })).rejects.toThrow();
    expect(m.recordOutcome).not.toHaveBeenCalled();
  });
});

describe("the service worker routes a rating action instead of navigating", () => {
  const sw = readFileSync(join(__dirname, "..", "..", "public", "sw.js"), "utf8");

  it("reads event.action at all — it previously never did", () => {
    expect(sw).toMatch(/event\.action/);
  });

  it("posts the verdict to the rating endpoint", () => {
    expect(sw).toContain("/api/outcomes/rate");
    expect(sw).toMatch(/credentials:\s*['"]include['"]/);
  });

  it("returns BEFORE the navigation block, so rating does not open the app", () => {
    // Opening the app on a 👍 punishes the operator for answering, which is the
    // surest way to stop them answering.
    const ratingIdx = sw.indexOf("/api/outcomes/rate");
    const navIdx = sw.indexOf("clients.matchAll");
    expect(ratingIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(ratingIdx);
    const between = sw.slice(ratingIdx, navIdx);
    expect(between).toMatch(/\breturn\b/);
  });

  it("does nothing when there is no ledger id to rate against", () => {
    expect(sw).toMatch(/if \(!data\.ledgerId\) return/);
  });
});

describe("the push payload carries the affordance", () => {
  const push = readFileSync(
    join(__dirname, "..", "..", "lib", "notifications", "push.ts"),
    "utf8",
  );
  const brief = readFileSync(
    join(__dirname, "..", "..", "lib", "inngest", "functions", "morning-brief.ts"),
    "utf8",
  );

  it("an explicit actions list overrides the level default", () => {
    // The level block sets actions AND vibrate/requireInteraction; the override
    // must come after it without dropping those.
    const levelIdx = push.indexOf('payload.level === "critical"');
    const overrideIdx = push.indexOf("payload.actions && payload.actions.length");
    expect(overrideIdx).toBeGreaterThan(levelIdx);
  });

  it("the brief ledgers BEFORE sending — the button needs an id that exists", () => {
    const ledgerIdx = brief.indexOf('kind: "daily_brief"');
    const sendIdx = brief.indexOf("await sendPush({");
    expect(ledgerIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(ledgerIdx);
  });

  it("sends WITHOUT buttons when ledgering failed, rather than not sending", () => {
    // The brief is the product; the ledger is bookkeeping. Since 2026-10-02 the
    // affordance has one owner: spread `ratingPushActions(ledgerId)`, which is
    // `{}` for a null id (behaviour pinned in
    // tests/inngest/intelligence-brief-ratable.test.ts), so a failed ledger
    // write still sends — just unrateable.
    expect(brief).toContain("...ratingPushActions(ledgerId)");
  });

  it("no longer points the brief at the retired /command route", () => {
    expect(brief).not.toContain('"/command"');
    expect(brief).not.toContain("bdnick.info/command");
  });
});
