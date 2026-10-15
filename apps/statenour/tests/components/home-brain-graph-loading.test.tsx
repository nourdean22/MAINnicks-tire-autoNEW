/**
 * UI v3 Wave 0, honesty fix (d): the Brain graph's first-load line.
 *
 * THE DEFECT. The initial spinner read "Loading brain . times out in 12s": a
 * countdown the operator did not ask for, printed while the screen is already
 * waiting. The 12 second abort stays (a hung request still converges to the
 * error state with Retry; the failure copy still names the seconds). The line
 * itself is now just "Loading brain".
 * Static markup: the first client render of the component is the initial phase.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/brain",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/components/home/brain-node-detail-panel", () => ({ BrainNodeDetailPanel: () => null }));

import { HomeBrainGraph } from "@/components/home/home-brain-graph";

const render = () => renderToStaticMarkup(<HomeBrainGraph variant="full" />);

describe("HomeBrainGraph first-load line", () => {
  it("says Loading brain and no countdown", () => {
    const html = render();
    expect(html, "the initial spinner did not render, so this test would be vacuous").toContain("Loading brain");
    // The whole label is the two words: no separator, no timeout, no seconds.
    expect(html).toContain(">Loading brain</span>");
    expect(html).not.toMatch(/times out/i);
  });

  it("the timeout behavior is untouched: the request still aborts on FETCH_TIMEOUT_MS and the error copy still names the seconds", () => {
    const src = readFileSync(join(__dirname, "..", "..", "components/home/home-brain-graph.tsx"), "utf8");
    expect(src).toMatch(/setTimeout\(\(\) => controller\.abort\(\), FETCH_TIMEOUT_MS\)/);
    expect(src).toMatch(/graph request timed out after \$\{FETCH_TIMEOUT_MS \/ 1000\}s/);
  });
});
