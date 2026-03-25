import { describe, it, expect } from "vitest";

describe("Email Configuration", () => {
  it("should have SHOP_EMAIL configured", () => {
    const shopEmail = process.env.SHOP_EMAIL;
    expect(shopEmail).toBeDefined();
    expect(shopEmail).toContain("@");
    expect(shopEmail!.toLowerCase()).toContain("gmail.com");
  });

  it("should have CEO_EMAIL configured", () => {
    const ceoEmail = process.env.CEO_EMAIL;
    expect(ceoEmail).toBeDefined();
    expect(ceoEmail).toContain("@");
    expect(ceoEmail!.toLowerCase()).toContain("gmail.com");
  });

  it("should have different emails for shop and CEO", () => {
    const shopEmail = process.env.SHOP_EMAIL?.toLowerCase();
    const ceoEmail = process.env.CEO_EMAIL?.toLowerCase();
    expect(shopEmail).not.toBe(ceoEmail);
  });
});
