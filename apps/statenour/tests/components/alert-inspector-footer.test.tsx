/**
 * UI v3 Wave 0, honesty fix (c): the alert inspector footer speaks plain words.
 *
 * THE DEFECT. Under the Resolve and Mute buttons the footer read "resolve
 * soft-deletes this alert (the receipt is its deletedAt) . mute hides the whole
 * category ...": a column name and an implementation term in front of the
 * operator, and no mention of how long Mute lasts. The footer now says what each
 * button does to the alert in the operator's words, and Mute names its window.
 * Static markup with trpc stubbed, the alert-inspector-states.test.tsx pattern.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const stubs = vi.hoisted(() => ({
  query: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
  mutate: vi.fn(),
}));

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
  stubs.query = { data: ALERT, isLoading: false, isError: false, error: null };
});

const render = () => renderToStaticMarkup(<AlertInspector entity={ENTITY} mode="inspect" />);

/** The visible text of the sentence under the action buttons. */
function footerText(html: string): string {
  const after = html.slice(html.indexOf("data-alert-actions"));
  const p = /<p class="[^"]*">([^<]*)<\/p>/.exec(after.slice(after.indexOf("</div>")));
  expect(p, "the footer sentence is missing").toBeTruthy();
  return p![1];
}

describe("AlertInspector footer", () => {
  it("names no column and no implementation term", () => {
    const html = render();
    expect(html).not.toMatch(/soft-delete/i);
    expect(html).not.toContain("deletedAt");
    expect(footerText(html)).not.toMatch(/soft-delete|deletedAt|receipt/i);
  });

  it("says what Resolve does and what Mute does, and Mute names its window", () => {
    const text = footerText(render());
    expect(text).toMatch(/Resolve/);
    expect(text).toMatch(/Mute/);
    expect(text).toContain(`${ALERT_MUTE_DAYS} days`);
    expect(text, "Mute must say what it hides").toMatch(/category/i);
  });

  it("names the surfaces Mute really hides (the alerts list, the Brain memory tab) and no Home card", () => {
    // components/brain/memory-tab.tsx mounts ActiveAlertsCard and the Recall inbox alerts bucket; Home has no alert card.
    const text = footerText(render());
    expect(text).toContain("alerts list");
    expect(text).toContain("Brain memory tab");
    expect(text).not.toContain("Brain memory card");
    expect(text).not.toMatch(/home/i);
  });

  it("uses no em dash and no emoji in the sentence it adds", () => {
    const text = footerText(render());
    expect(text).not.toContain(String.fromCharCode(0x2014));
    expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
  });

  it("POSITIVE CONTROL: the two verbs themselves are untouched (Resolve unarmed, Mute scoped to the category)", () => {
    const html = render();
    expect(html).toContain(">Resolve</button>");
    expect(html).toContain(`Mute correlation_alert · ${ALERT_MUTE_DAYS}d`);
    expect(html).toContain("min-h-[44px]");
  });
});
