/**
 * UI v3 W1a review round 2, item 9: the hydration claim through the REAL provider default.
 * NourStateProvider starts at DEFAULT_STATE (isLoading true) and renderToString runs no effects, so this
 * is exactly what the server sends and what the client's first render repeats: a status row with no word.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToString } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/missions" }));

import { NourStateProvider } from "@/lib/state/nour-state";
import { StateWord } from "@/components/hud/state-word";

describe("StateWord under the real provider default", () => {
  it("prints no word and no notch on the server render", () => {
    const html = renderToString(
      <NourStateProvider>
        <StateWord />
      </NourStateProvider>,
    );
    expect(html).toContain('role="status"');
    expect(html).not.toMatch(/Steady|Drifting|On fire|Scattered|Low energy|State unknown/);
    expect(html).not.toContain("notch");
  });
});
