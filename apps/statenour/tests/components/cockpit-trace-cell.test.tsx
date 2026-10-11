/**
 * The cockpit linked each run to /system/logs?trace=<id>, but /system/logs ignores `trace`, so the link opened an
 * unfiltered log (audit 10-X4, cockpit half). The cell is now plain text with the full id in its title.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const TRACE = "trace-abcdef0123456789";
const stubs = vi.hoisted(() => ({ stats: undefined as unknown }));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      cockpitStats: { useQuery: () => ({ data: stubs.stats, isFetching: false, refetch: async () => {} }) },
      setActivePromptVersion: { useMutation: () => ({ mutateAsync: async () => {} }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { CockpitObservabilityView } from "@/components/system/cockpit-observability-view";

describe("cockpit recent-run trace cell", () => {
  it("is not a link into a filter /system/logs does not apply, and keeps the full id on hover", () => {
    stubs.stats = {
      recentRuns: [{ id: "r1", traceId: TRACE, model: "anthropic/claude", status: "success", costCents: 1, durationMs: 1200 }],
    };
    const html = renderToStaticMarkup(<CockpitObservabilityView />);
    expect(html).toContain(TRACE.slice(0, 10)); // control: the run row rendered
    expect(html).not.toMatch(/<a[^>]*href="[^"]*\?trace=/);
    expect(html).toContain(`title="${TRACE}"`);
  });
});
