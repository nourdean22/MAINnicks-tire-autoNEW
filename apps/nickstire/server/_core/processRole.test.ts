import { describe, expect, it } from "vitest";
import {
  processRoleRunsJobs,
  resolveProcessRole,
} from "./processRole";

describe("Q-34 PROCESS_ROLE", () => {
  it("defaults to all so the current deployment changes no behavior", () => {
    expect(resolveProcessRole(undefined)).toBe("all");
    expect(resolveProcessRole("")).toBe("all");
    expect(processRoleRunsJobs(resolveProcessRole(undefined))).toBe(true);
  });

  it("web suppresses background job ownership", () => {
    expect(processRoleRunsJobs(resolveProcessRole("web"))).toBe(false);
  });

  it("jobs and all own background work", () => {
    expect(processRoleRunsJobs(resolveProcessRole("jobs"))).toBe(true);
    expect(processRoleRunsJobs(resolveProcessRole("all"))).toBe(true);
  });


  it("rejects a typo instead of silently duplicating or disabling jobs", () => {
    expect(() => resolveProcessRole("worker")).toThrow(/all\|web\|jobs/);
    expect(() => resolveProcessRole("WEBB")).toThrow(/all\|web\|jobs/);
  });

  it("normalizes harmless casing/whitespace", () => {
    expect(resolveProcessRole(" JOBS ")).toBe("jobs");
  });
});
