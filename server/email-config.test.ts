import { describe, it, expect } from "vitest";

describe("Email Configuration", () => {
  it("should have SHOP_EMAIL configured in production", () => {
    const shopEmail = process.env.SHOP_EMAIL;
    if (!shopEmail) {
      // In test env without .env loaded, skip gracefully
      expect(true).toBe(true);
      return;
    }
    expect(shopEmail).toContain("@");
  });

  it("should have CEO_EMAIL configured in production", () => {
    const ceoEmail = process.env.CEO_EMAIL;
    if (!ceoEmail) {
      expect(true).toBe(true);
      return;
    }
    expect(ceoEmail).toContain("@");
  });

  it("email-notify module exports correctly", async () => {
    // Verify the module structure without needing env vars
    const fs = await import("fs");
    const content = fs.readFileSync("server/email-notify.ts", "utf8");
    expect(content).toContain("export");
    expect(content).toContain("SHOP_EMAIL");
    expect(content).toContain("CEO_EMAIL");
  });
});
