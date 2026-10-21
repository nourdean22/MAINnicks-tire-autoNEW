/**
 * /ask tells the truth about who answers (Codex on #3185, thread 4329657189).
 *
 * admin-prune W2a removed qa.all and qa.answer, so no product path publishes an
 * answer any more. The page must not promise one: it says the shop replies, and
 * the email field says a reply needs it. Old published answers still list.
 *
 * Mounts the real page; only the tRPC client, layout chrome and motion are stubbed.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ metaDescription: "" }));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    qa: {
      published: { useQuery: () => ({ data: [], isLoading: false, isError: false, error: null }) },
      ask: {
        useMutation: (opts?: { onSuccess?: () => void }) => ({ mutate: () => opts?.onSuccess?.(), isPending: false }),
      },
    },
  },
}));
vi.mock("@/components/PageLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/InternalLinks", () => ({ default: () => null }));
vi.mock("@/components/LocalBusinessSchema", () => ({ default: () => null }));
vi.mock("@/components/SEO", () => ({
  SEOHead: ({ description }: { description: string }) => {
    h.metaDescription = description;
    return null;
  },
  Breadcrumbs: () => null,
}));
vi.mock("framer-motion", () => ({
  motion: { div: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div> },
  useInView: () => true,
}));

import AskMechanicPage from "@/pages/AskMechanicPage";

describe("/ask copy matches what the shop does", () => {
  it("does not promise a public answer", () => {
    const { container } = render(<AskMechanicPage />);
    expect(container.textContent).not.toMatch(/answer it publicly|answers? (it|them|questions?) publicly|same straight answer/i);
    expect(h.metaDescription).not.toMatch(/browse answered|publicly/i);
  });

  it("says the shop replies by email and the email field says a reply needs it", () => {
    const { container } = render(<AskMechanicPage />);
    expect(container.textContent).toMatch(/leave your email and we('|’)ll reply/i);
    fireEvent.click(screen.getByRole("button", { name: /ask your question/i }));
    const email = screen.getByLabelText(/email \(so we can reply\)/i) as HTMLInputElement;
    expect(email.required).toBe(false);
  });

  it("the sent confirmation does not send the customer to check a public page", () => {
    const { container } = render(<AskMechanicPage />);
    fireEvent.click(screen.getByRole("button", { name: /ask your question/i }));
    fireEvent.change(screen.getByLabelText(/your name/i), { target: { value: "Pat Doe" } });
    fireEvent.change(screen.getByLabelText(/your question/i), { target: { value: "How often should I rotate my tires?" } });
    fireEvent.click(screen.getByRole("button", { name: /submit question/i }));
    expect(container.textContent).toMatch(/question submitted/i);
    expect(container.textContent).not.toMatch(/check back/i);
    expect(container.textContent).toMatch(/reply/i);
  });
});
