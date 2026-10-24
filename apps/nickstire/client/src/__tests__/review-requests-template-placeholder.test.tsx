/**
 * The custom-template box on Outreach > Reviews > Settings shows the text customers actually get
 * when the box is left blank (Draft D, shared/postVisitText.ts). The placeholder is built from the
 * same function the server sends with, so the admin screen cannot describe a default that no
 * longer exists. The literal pin catches the opposite drift: a builder edit nobody approved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const h = vi.hoisted(() => ({
  settings: { enabled: 1, delayMinutes: 1440, maxPerDay: 20, cooldownDays: 30, messageTemplate: null } as Record<string, unknown>,
}));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: path === "reviewRequests.getSettings" ? h.settings : undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
  });
  const node = (path: string): any =>
    new Proxy(function noop() {}, {
      get(_t, key) {
        if (typeof key === "symbol" || key === "then") return undefined;
        if (key === "useQuery" || key === "useSuspenseQuery" || key === "useInfiniteQuery") return query(path);
        if (key === "useMutation") return () => ({ mutate: () => {}, mutateAsync: async () => ({}), isPending: false });
        return node(path ? `${path}.${String(key)}` : String(key));
      },
      apply() {
        return undefined;
      },
    });
  return { trpc: new Proxy({}, { get: (_t, key) => (key === "useUtils" || key === "useContext" ? () => node("utils") : node(String(key))) }) };
});
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), message: vi.fn() }),
  Toaster: () => null,
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: vi.fn(async () => true), default: () => null }));

import ReviewRequestsSection from "@/pages/admin/outreach/ReviewRequestsSection";

function openTemplateBox() {
  window.history.replaceState({}, "", "/admin?reviewTab=settings");
  const { container } = render(<ReviewRequestsSection />);
  fireEvent.click(screen.getByRole("button", { name: /Custom Message Template/ }));
  return container.querySelector("textarea") as HTMLTextAreaElement;
}

beforeEach(() => {
  window.history.replaceState({}, "", "/admin");
});
afterEach(() => {
  window.history.replaceState({}, "", "/admin");
});

describe("review-request custom template box", () => {
  it("shows Draft D as the default, with the placeholders left in", () => {
    expect(openTemplateBox().placeholder).toBe(
      "Hi {firstName}, it's Nick's Tire & Auto on Euclid. Thanks for coming in. If anything about the car feels off, text us here and we'll take care of it. If you have a minute, tell other Cleveland drivers how your visit went: {reviewUrl}",
    );
  });

  it("renders exactly what the shared builder returns", async () => {
    const { postVisitText } = await import("@shared/postVisitText");
    expect(openTemplateBox().placeholder).toBe(postVisitText("{firstName}", "{reviewUrl}"));
  });

  it("control: the help line still lists {service}, which custom templates support", () => {
    openTemplateBox();
    expect(screen.getByText(/Available placeholders/).textContent).toContain("{service}");
  });
});
