/**
 * Default tire markup card (PR 3182 review, 2026-10-19). It moved from owner/manager-only
 * Settings into Tires, which front_desk and tech also open, so the card gates itself to
 * owner/manager, and a save the server refused ({ success: false }) is never "saved".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  role: "owner" as string | undefined,
  result: { success: true, markup: 100 } as { success: boolean; markup?: number },
  mutate: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    adminSecurity: {
      status: { useQuery: () => ({ data: h.role ? { adminRole: h.role, permissions: [] } : undefined, isError: false, fetchStatus: "idle" }) },
    },
    gatewayTire: {
      updateMarkup: {
        useMutation: (opts: { onSuccess?: (r: unknown) => void }) => ({
          mutate: (vars: unknown) => {
            h.mutate(vars);
            opts.onSuccess?.(h.result);
          },
          isPending: false,
        }),
      },
    },
  },
}));
vi.mock("@/components/admin/ConfirmDialog", () => ({ confirmDialog: async () => true }));
vi.mock("sonner", () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));

import TireMarkupCard from "@/components/admin/TireMarkupCard";

afterEach(() => {
  h.role = "owner";
  h.result = { success: true, markup: 100 };
  h.mutate.mockClear();
  h.toastSuccess.mockClear();
  h.toastError.mockClear();
});

async function saveValue(v: string) {
  fireEvent.change(screen.getByLabelText("Markup percent"), { target: { value: v } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(h.mutate).toHaveBeenCalled());
}

describe("TireMarkupCard", () => {
  it.each(["front_desk", "tech", "accountant", "viewer"])("%s sees no markup editor", (role) => {
    h.role = role;
    render(React.createElement(TireMarkupCard));
    expect(screen.queryByText("Default tire markup")).toBeNull();
  });

  it("no editor before the role is known", () => {
    h.role = undefined;
    render(React.createElement(TireMarkupCard));
    expect(screen.queryByText("Default tire markup")).toBeNull();
  });

  it("owner sees it, and a confirmed save reports the saved value", async () => {
    render(React.createElement(TireMarkupCard));
    await saveValue("110");
    expect(h.mutate).toHaveBeenCalledWith({ markup: 110 });
    expect(h.toastSuccess).toHaveBeenCalledWith("Markup saved: 100%");
  });

  it("a refused save ({ success: false }) says it was not saved, with Retry, never 'saved'", async () => {
    h.result = { success: false };
    render(React.createElement(TireMarkupCard));
    await saveValue("110");
    expect(h.toastSuccess).not.toHaveBeenCalled();
    expect(await screen.findByText("The markup was not saved. The database could not be reached.")).toBeTruthy();
    const retry = screen.getByRole("button", { name: "Retry" });
    expect(retry.className).toMatch(/min-h-12/);
  });
});
