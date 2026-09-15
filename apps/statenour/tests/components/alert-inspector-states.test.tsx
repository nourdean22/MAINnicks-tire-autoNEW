/**
 * AlertInspector states (2026-09-15): loading / error / not-found are the
 * honest notices; a loaded alert shows its category, content and the two
 * verbs (resolve is two-tap: the first render is UNARMED; mute names the
 * category and the 7-day window). Static markup, mocked trpc, the
 * memory-inspector-states.test.tsx pattern.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
}

const stubs = vi.hoisted(() => {
  const blank = (): QueryStub => ({ data: undefined, isLoading: false, isError: false, error: null });
  return { query: blank(), blank, mutate: vi.fn() };
});

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      memoryById: { useQuery: () => stubs.query },
      resolveAlert: { useMutation: () => ({ mutate: stubs.mutate, isPending: false }) },
      muteAlertCategory: { useMutation: () => ({ mutate: stubs.mutate, isPending: false }) },
    },
    useUtils: () => ({ brain: { activeAlerts: { invalidate: async () => {} }, memoryById: { invalidate: async () => {} } } }),
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  usePathname: () => "/system/alerts",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

import { AlertInspector, ALERT_MUTE_DAYS } from "@/components/inspector/panels/alert-inspector";

const ENTITY = { kind: "alert", id: "al-1" } as const;
const ALERT = {
  id: "al-1",
  category: "correlation_alert",
  key: "sleep-vs-revenue",
  content: "Sleep under 6h correlates with a 30% drop in next-day revenue",
  source: "correlation-engine",
  evidence: "supported_inference",
  trustTier: "SYSTEM_DERIVED",
  confidence: 0.7,
  seenCount: 2,
  createdBy: null,
  createdAt: "2026-09-14T10:00:00.000Z",
  updatedAt: "2026-09-14T10:00:00.000Z",
  lastSeen: "2026-09-14T10:00:00.000Z",
  expiresAt: null,
  validFrom: null,
  validUntil: null,
  lastVerifiedAt: null,
  discoveryVerdict: null,
  supersededBy: null,
  supersedes: [],
};

beforeEach(() => {
  stubs.query = stubs.blank();
});

const render = () => renderToStaticMarkup(<AlertInspector entity={ENTITY} mode="inspect" />);

describe("AlertInspector", () => {
  it("loading / error / not-found are three different notices", () => {
    stubs.query.isLoading = true;
    expect(render()).toContain('data-inspector-state="loading"');
    stubs.query = { ...stubs.blank(), isError: true, error: new Error("boom") };
    expect(render()).toContain('data-inspector-state="error"');
    stubs.query = { ...stubs.blank(), data: null };
    const nf = render();
    expect(nf).toContain('data-inspector-state="not-found"');
    expect(nf).not.toContain("data-alert-actions");
  });

  it("a loaded alert shows category, content, an UNARMED resolve and a category-scoped mute", () => {
    stubs.query.data = ALERT;
    const html = render();
    expect(html).toContain('data-alert-inspector="al-1"');
    expect(html).toContain("correlation_alert");
    expect(html).toContain("30% drop in next-day revenue");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">resolve</button>");
    expect(html).not.toContain("tap again");
    expect(html).toContain(`mute correlation_alert · ${ALERT_MUTE_DAYS}d`);
    expect(html).toContain("min-h-[44px]");
    expect(html).toContain('data-evidence-mark="chip"');
  });
});
