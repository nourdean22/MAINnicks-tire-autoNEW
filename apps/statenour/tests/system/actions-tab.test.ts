/**
 * `?tab=` on /system/actions (wave E1): only the literal "logs" opens the History fold; Home's
 * `?tab=approvals` links, a missing value and garbage all leave it closed with the queue on top.
 */
import { describe, expect, it } from "vitest";
import { resolveActionsTab } from "@/app/(mastery)/system/actions/actions-tab";

describe("resolveActionsTab", () => {
  it("logs opens History", () => {
    expect(resolveActionsTab("logs")).toBe("logs");
  });

  it("approvals is the queue-first default", () => {
    expect(resolveActionsTab("approvals")).toBe("approvals");
  });

  it("garbage falls back to the queue-first default, never throws", () => {
    expect(resolveActionsTab("Logs")).toBe("approvals");
    expect(resolveActionsTab("logs ")).toBe("approvals");
    expect(resolveActionsTab("drop table")).toBe("approvals");
    expect(resolveActionsTab("")).toBe("approvals");
  });

  it("missing (null or undefined) is the queue-first default", () => {
    expect(resolveActionsTab(null)).toBe("approvals");
    expect(resolveActionsTab(undefined)).toBe("approvals");
  });
});
