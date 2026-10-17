/**
 * UI v3 Wave 4 (Mind), Journal: one field (audit item 6, PLAN W4 "Journal one field, no emoji").
 *
 * THE DEFECT. The reflect composer opened on a three- or four-box template form (What / So what /
 * Now what, SOAP, ...) at 13 px, which iOS zooms into on focus, so a ten-second thought cost three
 * boxes and a zoom. The fix, pinned by what renders: ONE 16 px field by default that saves as the
 * What of a What / So what / Now what reflection (the shape the server already accepts, so no
 * contract change); the structured templates are one tap away ("Use a template") and still save
 * their own fields; a draft that filled more than one box reopens structured so nothing is hidden.
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ mutateAsync: vi.fn() }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    journal: {
      reflect: { useMutation: () => ({ mutateAsync: h.mutateAsync }) },
      ghostCounterQuestion: { useQuery: () => ({ data: undefined }) },
    },
  },
}));
vi.mock("@/components/journal/memory-calibration", () => ({ MemoryCalibrationRitual: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/events/data-change", () => ({ notifyDataChanged: vi.fn() }));

import { ReflectComposer } from "@/components/journal/reflect-composer";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ReflectComposer />);
  });
  return container;
}

function type(el: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const button = (el: HTMLElement, name: RegExp) =>
  [...el.querySelectorAll("button")].find((b) => name.test(b.textContent ?? "")) as HTMLButtonElement | undefined;

beforeEach(() => {
  localStorage.clear();
  h.mutateAsync.mockReset();
  h.mutateAsync.mockResolvedValue({ pushback: null, nextStep: "done", extractionFired: false });
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Journal reflect composer: one field", () => {
  it("opens on ONE field at 16 px, not a template form", async () => {
    const el = await mount();
    const fields = el.querySelectorAll("textarea");
    expect(fields.length, "the composer still opens on a multi-box template").toBe(1);
    expect(fields[0].className).toContain("text-[16px]");
    expect(fields[0].getAttribute("aria-label")).toBeTruthy();
  });

  it("saves the one field as the What of a What / So what / Now what reflection", async () => {
    const el = await mount();
    await act(async () => type(el.querySelector("textarea")!, "Shipped the brief; next, call Sam."));
    await act(async () => button(el, /log reflection/i)!.click());
    expect(h.mutateAsync).toHaveBeenCalledTimes(1);
    const arg = h.mutateAsync.mock.calls[0][0];
    expect(arg.template).toBe("driscoll");
    expect(arg.fields).toEqual({ what: "Shipped the brief; next, call Sam." });
  });

  it("keeps the structured templates one tap away, and they still save their own fields", async () => {
    const el = await mount();
    const open = button(el, /use a template/i);
    expect(open, "no way to the structured templates").toBeTruthy();
    expect(open!.className).toContain("min-h-[44px]");
    await act(async () => open!.click());
    const fields = [...el.querySelectorAll("textarea")];
    expect(fields.length).toBe(3);
    for (const f of fields) expect(f.className).toContain("text-[16px]");
    await act(async () => type(fields[2], "call Sam"));
    await act(async () => button(el, /log reflection/i)!.click());
    expect(h.mutateAsync.mock.calls[0][0].fields).toMatchObject({ now_what: "call Sam" });
  });

  it("reopens structured when a saved draft filled more than the one field, so nothing is hidden", async () => {
    localStorage.setItem("ultron:reflect:draft", JSON.stringify({ fields: { what: "a", so_what: "b" }, templateKey: "driscoll" }));
    const el = await mount();
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelectorAll("textarea").length).toBe(3);
  });
});
