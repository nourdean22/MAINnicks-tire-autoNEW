/**
 * U5 (2026-10-30) · the composer sends every attached photo in one message.
 *
 * Before: the picker had no `multiple` and the send built exactly one file part from the single
 * attachment. Now the gallery input allows several, each shows its own row with its own Remove,
 * and one send carries one file part per photo (shrunk by prepareForSend, mocked here).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }) }));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({}),
    brain: { createPin: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
    chat: { deleteMessage: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
  },
}));
vi.mock("@/hooks/use-draft-autosave", () => ({ useDraftAutosave: () => ({ clearDraft: () => {}, restore: () => null }) }));
vi.mock("@/lib/media/compress-image", async (orig) => ({
  ...(await orig<typeof import("@/lib/media/compress-image")>()),
  prepareForSend: async (f: File) => {
    if (f.name.startsWith("bad")) throw new Error("unreadable");
    // Past MAX_INLINE_CHARS (24 M) once wrapped as a data: URL.
    if (f.name.startsWith("huge")) return { mimeType: "image/jpeg", base64: "Q".repeat(24_000_000), filename: f.name };
    return { mimeType: "image/jpeg", base64: "QQ==", filename: f.name };
  },
}));

import { ChatComposer } from "@/features/chat-v2/components/chat-composer";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const append = vi.fn();
const sendText = vi.fn();
const chat = { status: "ready", isStreaming: false, messages: [], sendText, append, setMessages: vi.fn(), stopTurn: vi.fn() } as any;
let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  append.mockClear();
  sendText.mockClear();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn((f: File) => `blob:${f.name}`), revokeObjectURL: vi.fn() }));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ChatComposer chat={chat} />));
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  useChatUiStore.setState({ draft: "" });
});

const galleryInput = () => host.querySelector('input[type="file"]:not([capture])') as HTMLInputElement;
async function pickPhotos(names: string[]) {
  const input = galleryInput();
  const files = names.map((n) => new File([new Uint8Array(800)], n, { type: "image/jpeg" }));
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("composer photos (U5)", () => {
  it("the gallery picker allows several files", () => {
    expect(galleryInput().multiple).toBe(true);
  });

  it("3 picked photos show 3 rows, each with its own Remove", async () => {
    await pickPhotos(["a.jpg", "b.jpg", "c.jpg"]);
    expect(host.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(3);
    expect(host.textContent).toContain("3 of 10 files");
  });

  it("one send carries one file part per photo, after the text", async () => {
    await pickPhotos(["a.jpg", "b.jpg"]);
    act(() => useChatUiStore.setState({ draft: "what's wrong with these tires" }));
    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(append).toHaveBeenCalledTimes(1);
    const parts = append.mock.calls[0][0].parts as Array<{ type: string; filename?: string }>;
    expect(parts.map((p) => p.type)).toEqual(["text", "file", "file"]);
    expect(parts.slice(1).map((p) => p.filename)).toEqual(["a.jpg", "b.jpg"]);
  });

  const submit = async (times = 1) => {
    const form = host.querySelector("form") as HTMLFormElement;
    await act(async () => {
      for (let i = 0; i < times; i++) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  };

  it("a double tap on Send sends the photos once", async () => {
    await pickPhotos(["a.jpg", "b.jpg"]);
    act(() => useChatUiStore.setState({ draft: "check these" }));
    await submit(2);
    expect(append).toHaveBeenCalledTimes(1);
  });

  it("no readable file and no text sends nothing and keeps the attachment", async () => {
    await pickPhotos(["bad.jpg"]);
    await submit();
    expect(append).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(1);
  });

  it("photos past the route's size cap are refused before upload and kept", async () => {
    await pickPhotos(["huge.jpg"]);
    act(() => useChatUiStore.setState({ draft: "look" }));
    await submit();
    expect(append).not.toHaveBeenCalled();
    expect(host.querySelectorAll('button[aria-label^="Remove "]')).toHaveLength(1);
  });
});
