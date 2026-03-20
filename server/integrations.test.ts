import { describe, it, expect } from "vitest";

describe("Integration Credentials", () => {
  it("should have Gateway Tire username set", () => {
    expect(process.env.GATEWAY_TIRE_USERNAME).toBeDefined();
    expect(process.env.GATEWAY_TIRE_USERNAME!.length).toBeGreaterThan(0);
  });

  it("should have Gateway Tire password set", () => {
    expect(process.env.GATEWAY_TIRE_PASSWORD).toBeDefined();
    expect(process.env.GATEWAY_TIRE_PASSWORD!.length).toBeGreaterThan(0);
  });

  it("should have Auto Labor username set", () => {
    expect(process.env.AUTO_LABOR_USERNAME).toBeDefined();
    expect(process.env.AUTO_LABOR_USERNAME!.length).toBeGreaterThan(0);
  });

  it("should have Auto Labor password set", () => {
    expect(process.env.AUTO_LABOR_PASSWORD).toBeDefined();
    expect(process.env.AUTO_LABOR_PASSWORD!.length).toBeGreaterThan(0);
  });
});
