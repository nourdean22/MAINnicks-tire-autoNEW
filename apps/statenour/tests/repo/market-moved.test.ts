/**
 * tests/repo/market-moved.test.ts · 2026-09-08 (program §5.11 · operator verdict MOVE)
 *
 * `/market` (Search Console + brand radar from the shop bridge) was the same
 * class as the deleted `/business`: shop analytics inside the personal OS.
 * The operator chose MOVE: the surface now lives in Nick's Tire admin
 * (`/admin/market`, nickstire PR), and StateNour keeps only a redirect. This
 * pins the retirement the way the R7 precedent did — page gone, nav gone,
 * the shop-flavoured palette probe gone, redirect present.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("/market moved to Nick's Tire admin", () => {
  it("the page and its components are gone", () => {
    expect(existsSync(join(ROOT, "app/(mastery)/market"))).toBe(false);
    expect(existsSync(join(ROOT, "components/market"))).toBe(false);
  });

  it("nav no longer lists it", () => {
    expect(read("components/layout/nav-items.ts")).not.toMatch(/href:\s*"\/market"/);
  });

  it("the redirect points at the shop admin, not at a personal-OS page", () => {
    const cfg = read("next.config.ts");
    expect(cfg).toMatch(/source:\s*"\/market",\s*destination:\s*"https:\/\/nickstire\.org\/admin\/market"/);
  });

  it("the shop dashboard probe left the command palette with its procedure", () => {
    expect(read("components/command-palette.tsx")).not.toMatch(/Check Business Dashboard/);
    expect(read("lib/trpc/routers/operator.ts")).not.toMatch(/businessDashboard:/);
  });
});
