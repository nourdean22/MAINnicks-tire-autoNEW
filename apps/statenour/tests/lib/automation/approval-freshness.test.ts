/**
 * tests/lib/automation/approval-freshness.test.ts · 2026-09-07
 *
 * The one predicate both approval queues consult. Expiry is about the
 * PERMISSION, never the obligation: nothing here deletes, declines or hides.
 */
import { describe, it, expect } from "vitest";
import {
  APPROVAL_FRESHNESS_DAYS,
  DEFAULT_FRESHNESS_DAYS,
  actionExpiresAt,
  expiredApprovalMessage,
  freshnessDaysFor,
  isActionExpired,
  isApprovalRequestExpired,
  freshnessTable,
  parseFreshnessOverrides,
} from "@/lib/automation/approval-freshness";

const NOW = new Date("2026-09-07T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

describe("freshness windows are per effect class", () => {
  it("outward messages and pricing go stale faster than record writes", () => {
    expect(freshnessDaysFor("send_email")).toBeLessThan(freshnessDaysFor("update_record"));
    expect(freshnessDaysFor("adjust_pricing")).toBeLessThan(freshnessDaysFor("create_record"));
  });

  it("an unknown or missing action type falls back to the default, never to 'forever'", () => {
    expect(freshnessDaysFor("something_new")).toBe(DEFAULT_FRESHNESS_DAYS);
    expect(freshnessDaysFor(null)).toBe(DEFAULT_FRESHNESS_DAYS);
    expect(freshnessDaysFor(undefined)).toBe(DEFAULT_FRESHNESS_DAYS);
  });

  it("every configured window is positive and finite", () => {
    for (const [type, days] of Object.entries(APPROVAL_FRESHNESS_DAYS)) {
      expect(days, type).toBeGreaterThan(0);
      expect(Number.isFinite(days), type).toBe(true);
    }
  });
});

describe("autonomous actions (no expiry column → derived from the action type)", () => {
  it("a two-day-old email approval is still live; a four-day-old one is expired", () => {
    expect(isActionExpired({ actionType: "send_email", createdAt: daysAgo(2) }, NOW)).toBe(false);
    expect(isActionExpired({ actionType: "send_email", createdAt: daysAgo(4) }, NOW)).toBe(true);
  });

  it("the 330-hour-old approvals Home was counting are expired under every window", () => {
    const old = new Date(NOW.getTime() - 330 * 3_600_000);
    for (const type of [...Object.keys(APPROVAL_FRESHNESS_DAYS), "unknown"]) {
      expect(isActionExpired({ actionType: type, createdAt: old }, NOW), type).toBe(true);
    }
  });

  it("expiresAt is createdAt plus the window, exactly at the boundary it is expired", () => {
    const created = daysAgo(3);
    expect(actionExpiresAt("send_email", created).getTime()).toBe(created.getTime() + 3 * 86_400_000);
    expect(isActionExpired({ actionType: "send_email", createdAt: created }, NOW)).toBe(true);
  });
});

describe("approval requests (their own expiresAt, written by the requester)", () => {
  it("expired when expiresAt has passed, live before it", () => {
    expect(isApprovalRequestExpired({ expiresAt: daysAgo(1) }, NOW)).toBe(true);
    expect(isApprovalRequestExpired({ expiresAt: new Date(NOW.getTime() + 3_600_000) }, NOW)).toBe(false);
  });

  it("a legacy row without expiresAt never expires (never invent a deadline)", () => {
    expect(isApprovalRequestExpired({ expiresAt: null }, NOW)).toBe(false);
    expect(isApprovalRequestExpired({ expiresAt: undefined }, NOW)).toBe(false);
  });
});

describe("the refusal message says what to do", () => {
  it("names re-request or dismiss, never 'declined'", () => {
    const msg = expiredApprovalMessage("action", daysAgo(1));
    expect(msg).toMatch(/re-request/);
    expect(msg).toMatch(/dismiss/);
    expect(msg).not.toMatch(/declined/i);
  });
});

describe("APPROVAL_FRESHNESS_DAYS env override", () => {
  it("a JSON map overrides per type and the default; garbage is ignored", () => {
    expect(freshnessDaysFor("send_email", { APPROVAL_FRESHNESS_DAYS: '{"send_email": 5}' })).toBe(5);
    expect(freshnessDaysFor("something_new", { APPROVAL_FRESHNESS_DAYS: '{"default": 10}' })).toBe(10);
    expect(freshnessDaysFor("send_email", { APPROVAL_FRESHNESS_DAYS: "not json" })).toBe(APPROVAL_FRESHNESS_DAYS.send_email);
    expect(parseFreshnessOverrides('{"send_email": -1, "x": "y"}')).toEqual({});
  });
  it("the effective table names its source per row so the UI never shows a mystery number", () => {
    const table = freshnessTable({ APPROVAL_FRESHNESS_DAYS: '{"send_sms": 1}' });
    expect(table.source).toBe("env");
    expect(table.windows.find((w) => w.actionType === "send_sms")).toEqual({ actionType: "send_sms", days: 1, source: "env" });
    expect(table.windows.find((w) => w.actionType === "send_email")).toEqual({ actionType: "send_email", days: APPROVAL_FRESHNESS_DAYS.send_email, source: "default" });
    expect(freshnessTable({}).source).toBe("default");
  });
});
