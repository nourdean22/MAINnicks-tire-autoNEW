/**
 * Admin UI v1 Wave 5, items 2 to 4: dead and developer-facing controls go.
 *   2. CustomerIntelligence Call and SMS: real tel: and sms: links, no body, always visible, 48 px,
 *      absent when the row has no phone. They were hover-only buttons with no handler.
 *   3. Ops Hub Reports tab: no repo paths and no "open them in the repo" note.
 *   4. AdminAlertBar: imported nowhere, file deleted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import React from "react";

type Q = { data: unknown; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void; isFetching: boolean };

const h = vi.hoisted(() => ({ queries: new Map<string, Partial<Q>>() }));

vi.mock("@/lib/trpc", () => {
  const query = (path: string) => () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: () => {},
    isFetching: false,
    ...h.queries.get(path),
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

import { CustomerIntelligence } from "@/pages/admin/intelligence/CustomerIntelligence";
import OpsHubSection from "@/pages/admin/OpsHubSection";
import { REPORT_DOCS } from "@/lib/opsRegistry";

const ok = (data: unknown): Partial<Q> => ({ data, isError: false });

beforeEach(() => h.queries.clear());
afterEach(() => h.queries.clear());

describe("CustomerIntelligence Call and Text", () => {
  function mount() {
    h.queries.set(
      "intelligence.nextBestActions",
      ok({
        actions: [
          { type: "vip_winback", message: "Pat Example has not visited in 200 days", urgency: 4, phone: "216-555-0100" },
          { type: "vip_winback", message: "Lee Example has not visited in 300 days", urgency: 3 },
        ],
      }),
    );
    h.queries.set("intelligence.masterReport", ok({}));
    return render(<CustomerIntelligence />);
  }

  it("a row with a phone gets a tel: link and an sms: link with no body", () => {
    mount();
    const call = screen.getByRole("link", { name: "Call 216-555-0100" });
    const text = screen.getByRole("link", { name: "Text 216-555-0100" });
    expect(call.getAttribute("href")).toBe("tel:2165550100");
    expect(text.getAttribute("href")).toBe("sms:2165550100");
    // No customer-facing text is authored here: the link carries no body or query at all.
    expect(text.getAttribute("href")).not.toMatch(/[?&]|body/i);
  });

  it("the row without a phone has no Call or Text control at all", () => {
    mount();
    expect(screen.getAllByRole("link")).toHaveLength(2);
    const lee = screen.getByText(/Lee Example/).closest("div[class*='border']") as HTMLElement;
    expect(within(lee).queryAllByRole("link")).toHaveLength(0);
  });

  it("the controls are visible without hover and 48 px, and nothing is a handler-less button", () => {
    const { container } = mount();
    for (const link of screen.getAllByRole("link")) {
      expect(link.className).toMatch(/\bmin-h-12\b/);
      expect(link.className).toMatch(/\bmin-w-12\b/);
      expect(link.closest("[class*='opacity-0']")).toBeNull();
      expect(link.className).not.toMatch(/group-hover:opacity|opacity-0/);
    }
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("Ops Hub Reports tab", () => {
  it("lists title, category and note, with no repo path and no 'open them in the repo' line", () => {
    const { container } = render(<OpsHubSection />);
    fireEvent.click(screen.getByRole("button", { name: /Reports/ }));
    for (const r of REPORT_DOCS) {
      expect(screen.getAllByText(r.title).length, r.title).toBeGreaterThan(0);
      expect(container.textContent, r.path).not.toContain(r.path);
    }
    expect(container.textContent).not.toMatch(/open them in the repo/i);
    expect(container.textContent).not.toMatch(/relative to the repository root/i);
  });

  it("positive control: the Owner Actions tab still renders its registry cards", () => {
    render(<OpsHubSection />);
    expect(screen.getAllByText("Next:", { exact: false }).length).toBeGreaterThan(0);
  });
});

describe("AdminAlertBar", () => {
  const NAME = "Admin" + "AlertBar";
  const root = process.cwd();

  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) {
        if (e !== "__tests__" && e !== "node_modules") sources(full, out);
      } else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e)) out.push(full);
    }
    return out;
  }

  it("the file is gone", () => {
    expect(existsSync(join(root, "client/src/components/admin", NAME + ".tsx"))).toBe(false);
  });

  it("nothing in the client tree imports or names it", () => {
    const hits = sources(join(root, "client/src")).filter((f) => readFileSync(f, "utf8").includes(NAME));
    expect(hits).toEqual([]);
  });
});
