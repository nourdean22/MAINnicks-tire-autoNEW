/**
 * The cockpit "Prompt Version Manager" toggle deployed nothing (audit 06-F11): setActivePromptVersion flipped
 * prompt_versions.active, and no prompt builder reads that column (the live prompt is assembled in code). A switch
 * that changes nothing reads as a control, so the table is display-only and the mutation is gone.
 * Table drop is operator work (OP-16).
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stubs = vi.hoisted(() => ({
  stats: {
    promptVersions: [
      { id: "pv1", version: 1, active: true, systemPrompt: "You are Nick", createdAt: "2026-06-01T00:00:00.000Z", totalRuns: null, usageAttributionAvailable: false },
      { id: "pv2", version: 2, active: false, systemPrompt: "You are Nick v2", createdAt: "2026-07-01T00:00:00.000Z", totalRuns: null, usageAttributionAvailable: false },
    ],
  } as unknown,
}));

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
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
import { agentsProcedures } from "@/lib/trpc/routers/system/agents";

function promptPanel(): string {
  const html = renderToStaticMarkup(<CockpitObservabilityView />);
  const start = html.indexOf("Prompt Version");
  expect(start).toBeGreaterThan(-1); // anchor found, or the checks below scan nothing
  return html.slice(start);
}

describe("cockpit prompt versions are display-only", () => {
  it("control: the table still lists the versions and which one is flagged active", () => {
    const panel = promptPanel();
    expect(panel).toContain("v1");
    expect(panel).toContain("v2");
    expect(panel).toContain("Active");
  });

  it("offers no button and no toggle/deploy promise", () => {
    const panel = promptPanel();
    expect(panel).not.toContain("<button");
    expect(panel).not.toMatch(/toggle|deploy/i);
    expect(panel).toContain("Display only: the live prompt is built in code");
  });

  it("the system router no longer carries setActivePromptVersion", () => {
    expect(Object.keys(agentsProcedures)).not.toContain("setActivePromptVersion");
    expect(Object.keys(agentsProcedures)).toContain("cockpitStats"); // control: the walk saw the real object
  });
});
