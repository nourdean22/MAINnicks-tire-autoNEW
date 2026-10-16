/**
 * UI v3 W1b: `?tab=` on /system/actions. Home's "Review approvals" links carry `?tab=approvals`;
 * anything else (missing, garbage, the literal "logs") is the log, the page's default.
 */
import { describe, expect, it } from "vitest";
import { resolveActionsTab } from "@/app/(mastery)/system/actions/actions-tab";

describe("resolveActionsTab", () => {
  it("approvals opens the approvals panel", () => {
    expect(resolveActionsTab("approvals")).toBe("approvals");
  });

  it("logs is the log", () => {
    expect(resolveActionsTab("logs")).toBe("logs");
  });

  it("garbage falls back to the log, never throws", () => {
    expect(resolveActionsTab("Approvals")).toBe("logs");
    expect(resolveActionsTab("approvals ")).toBe("logs");
    expect(resolveActionsTab("drop table")).toBe("logs");
    expect(resolveActionsTab("")).toBe("logs");
  });

  it("missing (null or undefined) is the log", () => {
    expect(resolveActionsTab(null)).toBe("logs");
    expect(resolveActionsTab(undefined)).toBe("logs");
  });
});
