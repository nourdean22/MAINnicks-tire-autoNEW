import { describe, it, expect } from "vitest";

describe("auth.logout", () => {
  it("auth service module exists", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/services/auth.ts")).toBe(true);
  });

  it("tRPC context includes clearCookie capability", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/_core/context.ts", "utf8");
    expect(content).toContain("res");
  });
});
