// @vitest-environment jsdom
/**
 * U5 (2026-10-30) · several photos per message.
 *
 * Before: the picker had no `multiple`, the hook kept one file and read only files[0] from a pick,
 * a paste or a drop. Now: up to 10 attachments, each removable, and prepareAll reports progress
 * while it shrinks them (prepareForSend is mocked here; its resize math is tested on its own).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const toastFn = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: Object.assign(toastFn, { error: vi.fn(), success: vi.fn() }) }));
const prepare = vi.hoisted(() => vi.fn(async (f: File) => ({ mimeType: "image/jpeg", base64: "QQ==", filename: f.name })));
vi.mock("@/lib/media/compress-image", async (orig) => ({ ...(await orig<typeof import("@/lib/media/compress-image")>()), prepareForSend: prepare }));

import { useImageAttachment } from "@/hooks/use-image-attachment";
import { scaledSize } from "@/lib/media/compress-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
function renderHook<T>(hook: () => T): { result: { current: T } } {
  const result = { current: undefined as unknown as T };
  function Probe() { result.current = hook(); return null; }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(React.createElement(Probe)));
  return { result };
}
const jpeg = (name: string) => new File([new Uint8Array(1000)], name, { type: "image/jpeg" });
const pick = (files: File[]) => ({ target: { files, value: "x" } }) as unknown as React.ChangeEvent<HTMLInputElement>;

beforeEach(() => {
  toastFn.mockClear();
  prepare.mockClear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((f: File) => `blob:${f.name}`), revokeObjectURL: vi.fn() }));
});
afterEach(() => { act(() => root?.unmount()); root = null; });

describe("useImageAttachment (several files)", () => {
  it("one pick of 3 photos attaches all 3", () => {
    const { result } = renderHook(() => useImageAttachment());
    act(() => result.current.handleFileChange(pick([jpeg("a.jpg"), jpeg("b.jpg"), jpeg("c.jpg")])));
    expect(result.current.attached?.map((a) => a.file.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
  });

  it("keeps the first 10 and says so; Remove drops one; Remove all clears", () => {
    const { result } = renderHook(() => useImageAttachment());
    act(() => result.current.handleFileChange(pick(Array.from({ length: 12 }, (_, i) => jpeg(`p${i}.jpg`)))));
    expect(result.current.attached).toHaveLength(10);
    expect(toastFn).toHaveBeenCalledWith(expect.stringContaining("10 files per message"), expect.anything());

    act(() => result.current.remove(0));
    expect(result.current.attached?.[0].file.name).toBe("p1.jpg");
    expect(result.current.attached).toHaveLength(9);

    act(() => result.current.clear());
    expect(result.current.attached).toBeNull();
  });

  it("prepareAll returns one prepared file per attachment, in order", async () => {
    const { result } = renderHook(() => useImageAttachment());
    act(() => result.current.handleFileChange(pick([jpeg("a.jpg"), jpeg("b.jpg")])));
    let out: Array<{ filename: string }> = [];
    await act(async () => { out = await result.current.prepareAll(); });
    expect(out.map((p) => p.filename)).toEqual(["a.jpg", "b.jpg"]);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(result.current.preparing).toBeNull();
  });

  it("CONTROL: nothing attached prepares nothing", async () => {
    const { result } = renderHook(() => useImageAttachment());
    let out: unknown[] = ["x"];
    await act(async () => { out = await result.current.prepareAll(); });
    expect(out).toEqual([]);
  });
});

describe("photo resize target", () => {
  it("caps the long side at 2048 and keeps the shape; small photos unchanged", () => {
    expect(scaledSize(4032, 3024)).toEqual({ w: 2048, h: 1536 });
    expect(scaledSize(3024, 4032)).toEqual({ w: 1536, h: 2048 });
    expect(scaledSize(1200, 900)).toEqual({ w: 1200, h: 900 });
  });
});
