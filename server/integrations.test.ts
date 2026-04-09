import { describe, it, expect } from "vitest";

const HAS_GATEWAY = !!process.env.GATEWAY_TIRE_USERNAME;
const HAS_ALG = !!process.env.AUTO_LABOR_USERNAME;

describe.skipIf(!HAS_GATEWAY)("Gateway Tire Credentials", () => {
  it("should have Gateway Tire username set", () => {
    expect(process.env.GATEWAY_TIRE_USERNAME).toBeTruthy();
  });
  it("should have Gateway Tire password set", () => {
    expect(process.env.GATEWAY_TIRE_PASSWORD).toBeTruthy();
  });
});

describe.skipIf(!HAS_ALG)("Auto Labor Credentials", () => {
  it("should have Auto Labor username set", () => {
    expect(process.env.AUTO_LABOR_USERNAME).toBeTruthy();
  });
  it("should have Auto Labor password set", () => {
    expect(process.env.AUTO_LABOR_PASSWORD).toBeTruthy();
  });
});

describe("Integration Module Structure", () => {
  it("gateway tire router exists", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/routers/gatewayTire.ts")).toBe(true);
  });
  it("shopdriver router exists", async () => {
    const fs = await import("fs");
    expect(fs.existsSync("server/routers/shopdriver.ts")).toBe(true);
  });
});
