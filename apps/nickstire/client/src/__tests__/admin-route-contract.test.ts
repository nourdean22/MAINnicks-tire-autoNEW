import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REQUIRED_ADMIN_ROUTES = [
  "/admin",
  "/admin/content",
  "/admin/ig-studio",
  "/admin/reel-studio",
  "/admin/ad-studio",
] as const;

describe("admin route contract", () => {
  it("keeps every operator entry route wired in App.tsx", () => {
    const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

    for (const route of REQUIRED_ADMIN_ROUTES) {
      expect(appSource, `Missing required admin route: ${route}`).toContain(`path={"${route}"}`);
    }
  });

  it("keeps the admin page and ad studio lazy imports wired", () => {
    const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

    expect(appSource).toContain('const Admin = lazy(() => import("./pages/Admin"))');
    expect(appSource).toContain('const AdminAdStudio = lazy(() => import("./pages/admin/AdStudio"))');
  });
});
