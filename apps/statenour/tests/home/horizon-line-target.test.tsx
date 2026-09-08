/**
 * tests/home/horizon-line-target.test.tsx · 2026-09-08 (section 5.8, review on #2202)
 *
 * The hermetic e2e database has no MIT / task / event / goal, so Home never
 * renders a horizon slot in CI and the 390px target audit cannot see these
 * links. This renders the real component with a fixture slot (react-dom/server,
 * the repo's node-environment convention) and pins the 44px row + link sizing.
 */
import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { HorizonLine } from "@/components/home/horizon-line";

const horizon = {
  measured: true,
  slots: [{ scope: "today" as const, label: "Weekly revenue — 4 full floors", href: "/missions", source: "mit" }],
};

describe("HorizonLine rows are 44px tap targets", () => {
  it("renders each slot as a 44px row whose link is a 44px block (py-3 on a 20px line)", () => {
    const html = renderToString(<HorizonLine horizon={horizon} />);
    expect(html).toContain('href="/missions"');
    expect(html).toMatch(/<li[^>]*class="[^"]*min-h-\[44px\][^"]*"/);
    expect(html).toMatch(/<a[^>]*class="[^"]*\bblock\b[^"]*\bpy-3\b[^"]*"/);
    expect(html).not.toMatch(/min-h-\[36px\]|py-0\.5/);
  });
});
