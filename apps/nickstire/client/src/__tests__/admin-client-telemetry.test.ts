import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordAdminClientError } from "@/lib/adminClientTelemetry";

const STORAGE_KEY = "nickstire.adminClientErrors";

describe("recordAdminClientError", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns a support reference and persists a bounded diagnostic record", () => {
    const record = recordAdminClientError({
      sectionName: "Today",
      error: new Error("render failed"),
      componentStack: "at Today",
    });

    expect(record.reference).toMatch(/^ADM-/);
    expect(record.sectionName).toBe("Today");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "[]")[0]).toMatchObject({
      reference: record.reference,
      message: "render failed",
    });
  });

  it("emits a structured event for monitoring subscribers", () => {
    const listener = vi.fn();
    window.addEventListener("nickstire:admin-client-error", listener);

    recordAdminClientError({ sectionName: "Customers", error: new Error("boom") });

    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("nickstire:admin-client-error", listener);
  });
});
