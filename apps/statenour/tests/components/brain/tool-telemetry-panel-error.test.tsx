/**
 * tests/components/brain/tool-telemetry-panel-error.test.tsx · 2026-09-02.
 *
 * A TELEMETRY READ FAILURE IS NOT 185 HEALTHY TOOLS.
 *
 * `getToolStats` used to log and `return []`, and the procedure then rebuilt
 * every row from TOOL_CATALOG — so a dead database rendered the whole
 * catalog with `totalCalls: 0`, `successRate: 0`, `problem: []`, and a green
 * `CheckCircle2` beside every tool name. This panel had NO isError branch
 * (only `isLoading` at :86) because the procedure could not error.
 *
 * The second half is the empty state at :100, whose copy read "no tool calls
 * recorded yet — send a chat message that triggers a tool to populate". That
 * was unreachable for its stated reason: rows are catalog-derived, not
 * call-derived, so an empty list means the CATALOG came back empty and
 * calling a tool would not add one. The only way to reach it WAS a whole-
 * query failure, where the copy was simply wrong.
 *
 * Three states must now render three different things: ERROR, an empty
 * catalog (UNMEASURED), and a populated catalog with zero recorded calls —
 * which is what the old copy was actually reaching for.
 */

import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PROVENANCE_LABEL } from "@/components/ui/empty-state";

interface QueryState {
  data?: {
    stats: unknown[];
    problem: string[];
    drift?: unknown;
    missingEnvKeys?: string[];
  };
  isLoading: boolean;
  isError: boolean;
  error: { message: string } | null;
}

let queryState: QueryState = { isLoading: false, isError: false, error: null };

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      toolTelemetry: {
        useQuery: () => ({
          ...queryState,
          dataUpdatedAt: Date.now(),
          refetch: vi.fn(),
        }),
      },
    },
  },
}));

import { ToolTelemetryPanel } from "@/components/brain/tool-telemetry-panel";

/** One enriched catalog row as the procedure builds it. */
function catalogRow(toolName: string, totalCalls: number) {
  return {
    toolName,
    category: "brain",
    description: "does a thing",
    mutates: false,
    riskClass: "low" as const,
    status: "active" as const,
    requiredEnv: [] as string[],
    missingEnv: [] as string[],
    totalCalls,
    successRate: totalCalls > 0 ? 1 : 0,
    avgDurationMs: 0,
    failCount: 0,
    lastCallAt: undefined,
    lastErrors: [] as Array<{ message: string; at: number }>,
    registered: true,
    liveInToolset: true,
  };
}

function render(state: QueryState): string {
  queryState = state;
  return renderToStaticMarkup(<ToolTelemetryPanel />);
}

const OK = (stats: unknown[]): QueryState => ({
  data: { stats, problem: [], missingEnvKeys: [] },
  isLoading: false,
  isError: false,
  error: null,
});

describe("ToolTelemetryPanel · three states, three renders", () => {
  it("a failed read says so — and does NOT draw the catalog", () => {
    const html = render({
      isLoading: false,
      isError: true,
      error: { message: "telemetry read failed" },
    });

    expect(html).toContain('data-provenance="ERROR"');
    expect(html).toContain(PROVENANCE_LABEL.ERROR);
    expect(html).toContain("telemetry read failed");
    // The old copy, which would have been the render here before the fix.
    expect(html).not.toContain("no tool calls recorded yet");
    // No table, no green checks — nothing on this page has been checked.
    expect(html).not.toContain("<table");
    expect(html).not.toContain("lucide-check-circle");
  });

  it("an empty catalog is UNMEASURED, and does not blame the operator for it", () => {
    const html = render(OK([]));

    expect(html).toContain('data-provenance="UNMEASURED"');
    expect(html).not.toContain('data-provenance="ERROR"');
    // The old copy told the operator to trigger a tool. That would not have
    // added a row: these come from TOOL_CATALOG.
    expect(html).not.toContain("no tool calls recorded yet");
    expect(html).toContain("not from invocations");
  });

  it("a populated catalog with zero calls says UNMEASURED beside a real table", () => {
    // The condition the old empty state was reaching for — now reachable,
    // and now distinguishable from the two failures above.
    const html = render(OK([catalogRow("a", 0), catalogRow("b", 0)]));

    expect(html).toContain("<table");
    expect(html).toContain("unmeasured, not zero");
    expect(html).toContain("not one invocation has been");
    expect(html).not.toContain('data-provenance="ERROR"');
  });

  it("CONTROL · real traffic renders the table with no unmeasured banner", () => {
    // Without this, printing the banner unconditionally would pass above
    // while defacing the working page.
    const html = render(OK([catalogRow("a", 42)]));

    expect(html).toContain("<table");
    expect(html).not.toContain("unmeasured, not zero");
    expect(html).not.toContain(PROVENANCE_LABEL.ERROR);
  });

  it("the error render and the healthy render are not mistakable", () => {
    const failed = render({
      isLoading: false,
      isError: true,
      error: { message: "boom" },
    });
    const healthy = render(OK([catalogRow("a", 42)]));

    expect(failed).not.toEqual(healthy);
  });
});
