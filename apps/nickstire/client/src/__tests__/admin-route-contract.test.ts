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

  it("keeps the admin page and the /admin/* path redirect lazy imports wired", () => {
    const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

    expect(appSource).toContain('const Admin = lazy(() => import("./pages/Admin"))');
    // 2026-10-19: Ad Studio was cut; /admin/ad-studio redirects to Instagram, and any
    // other /admin/<slug> path goes through the admin's slug resolver.
    expect(appSource).toContain('const AdminPathRedirect = lazy(() => import("./pages/admin/AdminPathRedirect"))');
    expect(appSource).toContain('<Route path={"/admin/ad-studio"}>{() => <Redirect to="/admin?tab=instagram" replace />}</Route>');
    expect(appSource.indexOf('path={"/admin/*"}')).toBeGreaterThan(appSource.indexOf('path={"/admin/ad-studio"}'));
  });
});
