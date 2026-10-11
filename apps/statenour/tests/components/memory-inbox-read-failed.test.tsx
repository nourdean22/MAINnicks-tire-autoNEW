/**
 * /system/inbox: a failed read is unknown, never "Memory Queue Clear ... safe"
 * (audit 2026-10-10, 02-F13).
 *
 * THE DEFECT. `items = data ?? []`, then `items.length === 0` rendered "Memory
 * Queue Clear. All facts ingested from external sources are safe." and the
 * header said "All ingested memories clear and committed". A failed read (and
 * the first render, before any read) produced exactly that: a safety claim
 * about a quarantine queue nobody had looked at.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

const stub = vi.hoisted(() => ({
  q: {} as Record<string, unknown>,
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    system: {
      getQuarantinedItems: { useQuery: () => stub.q },
      resolveInboxItem: { useMutation: () => ({ mutateAsync: async () => {}, isPending: false }) },
    },
  },
}));

vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ description, children }: { description?: ReactNode; children?: ReactNode }) => (
    <main>
      <p data-description="">{description}</p>
      {children}
    </main>
  ),
}));
vi.mock("@/components/ui/freshness-chip", () => ({ FreshnessChip: () => null }));

import MemoryInboxPage from "@/app/(mastery)/system/inbox/page";

const q = (over: Record<string, unknown>) => ({
  data: undefined,
  isError: false,
  isPending: false,
  isFetching: false,
  error: null,
  dataUpdatedAt: 0,
  refetch: () => {},
  ...over,
});

const render = () => renderToStaticMarkup(<MemoryInboxPage />);

beforeEach(() => {
  stub.q = q({ data: [] });
});

describe("/system/inbox: a failed read is unknown, not clear", () => {
  it("a failed read says unknown and makes no safety claim", () => {
    stub.q = q({ isError: true, error: { message: "upstream 500" } });
    const html = render();
    expect(html).toContain("unknown - read failed");
    expect(html).toContain("upstream 500");
    expect(html).not.toContain("Memory Queue Clear");
    expect(html).not.toMatch(/\bsafe\b/);
    expect(html).not.toContain("clear and committed");
  });

  it("a failed poll after an empty success is unknown, not clear (React Query keeps the old [] as data)", () => {
    stub.q = q({ data: [], isError: true, error: { message: "poll 500" } });
    const html = render();
    expect(html).toContain("unknown - read failed");
    expect(html).toContain("poll 500");
    expect(html).not.toContain("Memory Queue Clear");
    expect(html).not.toContain("clear and committed");
  });

  it("before the first read lands, the queue is not called clear", () => {
    stub.q = q({ isPending: true, isFetching: true });
    const html = render();
    expect(html).not.toContain("Memory Queue Clear");
    expect(html).not.toContain("clear and committed");
  });

  it("POSITIVE CONTROL: a successful empty read keeps its clear copy", () => {
    const html = render();
    expect(html).toContain("Memory Queue Clear");
    expect(html).not.toContain("read failed");
  });
});
