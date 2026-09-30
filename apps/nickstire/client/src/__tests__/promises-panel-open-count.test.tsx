/**
 * Q-23 phase 3 · the Promises panel header never states a count it did not read.
 *
 * The "Today, for real" card shows the ledger's true open total and, when it
 * cannot read the ledger, sends the operator to this panel. So this header must
 * agree with the card or say why it cannot:
 *   - listOpen returns at most 50 rows, so a full page is "50+ open", never a
 *     total of 50 (the page-size-as-total shape the sweep's report already fixed);
 *   - a failed or in-flight read has no count, so the header must not say
 *     "0 open" above a body that says "UNKNOWN, not zero".
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  list: { data: [] as unknown[] | undefined, isLoading: false, isError: false },
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ promises: { listOpen: { invalidate: () => {} } } }),
    promises: {
      listOpen: { useQuery: () => h.list },
      create: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      keep: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      cancel: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: () => Promise.resolve(false) }));

import PromisesPanel from "@/pages/admin/PromisesPanel";

afterEach(cleanup);

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    promiseType: "callback",
    customerName: null,
    customerPhone: null,
    promisedAction: `call back customer ${i}`,
    owner: null,
    dueAt: new Date(Date.now() + 3_600_000).toISOString(),
    status: "open",
    keptAt: null,
    keptEvidence: null,
    escalatedAt: null,
    createdBy: "test",
    createdAt: new Date().toISOString(),
  }));
}

// "Promises" runs straight into the count ("Promises3 open"), so the patterns
// anchor on "not preceded by a digit" rather than on a word boundary.
function header(container: HTMLElement): string {
  return container.querySelector("header")?.textContent ?? "";
}

describe("PromisesPanel header count", () => {
  it("a page with room left states the count it read", () => {
    h.list = { data: rows(3), isLoading: false, isError: false };
    const { container } = render(<PromisesPanel />);
    expect(header(container)).toMatch(/(?<!\d)3 open/);
  });

  it("a full page says 50+, never a total of 50", () => {
    h.list = { data: rows(50), isLoading: false, isError: false };
    const { container } = render(<PromisesPanel />);
    expect(header(container)).toMatch(/50\+ open/);
    expect(header(container)).not.toMatch(/(?<!\d)50 open/);
  });

  it("a failed read never reads as 0 open", () => {
    h.list = { data: undefined, isLoading: false, isError: true };
    const { container } = render(<PromisesPanel />);
    expect(header(container)).not.toMatch(/(?<!\d)0 open/);
    expect(header(container)).toMatch(/unknown/i);
  });

  it("a read still loading never reads as 0 open", () => {
    h.list = { data: undefined, isLoading: true, isError: false };
    const { container } = render(<PromisesPanel />);
    expect(header(container)).not.toMatch(/(?<!\d)0 open/);
  });

  // Positive control: a genuinely empty ledger IS a stated zero.
  it("a genuine empty ledger states 0 open", () => {
    h.list = { data: [], isLoading: false, isError: false };
    const { container } = render(<PromisesPanel />);
    expect(header(container)).toMatch(/(?<!\d)0 open/);
  });
});
