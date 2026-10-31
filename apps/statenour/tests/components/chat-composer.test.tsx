// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { ChatComposer } from "@/features/chat-v2/components/chat-composer";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn(), loading: vi.fn(() => "t1"), dismiss: vi.fn() }),
}));

// 2026-07-11 · ChatComposer now calls useRouter() (slash-nav wiring), which
// needs the app-router context that SSR-render lacks — mock it.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/lib/state/nour-state", () => ({
  useNourState: () => ({
    todayRevenue: 0,
    weekRevenue: 0,
    pipelineValue: 0,
    agingCritical: 0,
    staleLeads: 0,
    overdueCommitments: 0,
    urgentItems: [],
    activeCommitments: 0,
    currentState: "Focus",
    habitsTotal: 0,
  }),
}));

vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({}),
    // The live composer calls trpc.brain.createPin.useMutation() at render.
    brain: {
      createPin: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) },
    },
    // 2026-08-19 · #1672 added edit-resend truncation, which calls
    // trpc.chat.deleteMessage.useMutation() at render — the mock lagged
    // the component and this file failed on main since that merge.
    chat: {
      deleteMessage: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) },
    },
  },
}));

vi.mock("@/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({
    clearDraft: () => {},
    restore: () => null,
  }),
}));

describe("ChatComposer Component", () => {
  it("renders the compose textarea", () => {
    const mockChat = {
      status: "idle",
      sendText: vi.fn(),
      append: vi.fn(),
    } as any;

    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);
    expect(markup).toContain('placeholder="Ask, analyze, create, or tell Nick to act…"');
  });

  // 2026-08-28 · Operator directive: no capability dials in the composer.
  // posture/depth were a thinking tax; turbo was provably DEAD (it armed
  // providerOverride:"anthropic" with no ANTHROPIC_API_KEY in any env, so
  // it silently degraded every time); private was removed by decision.
  // Read-aloud and Edit moved onto the messages themselves. This pins the
  // removal so a future refactor cannot quietly reintroduce a knob.
  it("renders no capability chips — the composer is input only", () => {
    const mockChat = { status: "idle", sendText: vi.fn(), append: vi.fn() } as any;
    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);

    expect(markup).not.toContain("authority-controls");
    expect(markup).not.toContain("private-lab-banner");
    expect(markup).not.toContain("control-sheet-");
    for (const chip of ["posture", "depth", "turbo", "private"]) {
      expect(markup.toLowerCase()).not.toContain(`>${chip}<`);
    }
  });

  it("keeps the controls that act on the draft itself", () => {
    const mockChat = { status: "idle", sendText: vi.fn(), append: vi.fn() } as any;
    const markup = renderToStaticMarkup(<ChatComposer chat={mockChat} />);

    expect(markup).toContain('aria-label="Attach image, audio or PDF"');
    expect(markup).toContain('aria-label="Voice input"');
    expect(markup).toContain('aria-label="Send message"');
  });
});

// R3-05 (04-X1): an attached voice memo was base64'd into the message, so the
// model got bytes it cannot hear, while the transcription route and its hook
// had no caller. Audio now goes to /api/ai/chat/audio-transcribe and the
// transcript lands in the draft for the operator to read before sending.
describe("ChatComposer . audio attachments are transcribed", () => {
  const originalCreate = URL.createObjectURL;
  afterEach(() => {
    vi.unstubAllGlobals();
    URL.createObjectURL = originalCreate;
    useChatUiStore.setState({ draft: "" });
  });

  async function pick(file: File) {
    const container = document.createElement("div");
    const root = createRoot(container);
    const chat = { status: "ready", isStreaming: false, messages: [], sendText: vi.fn(), append: vi.fn() } as any;
    await act(async () => root.render(<ChatComposer chat={chat} />));
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    // Let the fetch and its .json() settle.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    act(() => root.unmount());
  }

  it("a picked audio file is POSTed for transcription and the transcript joins the draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ transcript: "call notes" }), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    useChatUiStore.setState({ draft: "" });

    await pick(new File(["x"], "memo.m4a", { type: "audio/x-m4a" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/ai/chat/audio-transcribe", expect.objectContaining({ method: "POST" }));
    expect(useChatUiStore.getState().draft).toContain("call notes");
    expect(URL.createObjectURL, "audio must not become an inline attachment").not.toHaveBeenCalled();
  });

  // R3-15 (review finding 8): a Finder-copied file also carries its name as
  // text/plain, so a paste the composer consumed as audio still typed it.
  async function paste(items: Array<{ kind: string; type: string; getAsFile: () => File | null }>): Promise<boolean> {
    const container = document.createElement("div");
    const root = createRoot(container);
    const chat = { status: "ready", isStreaming: false, messages: [], sendText: vi.fn(), append: vi.fn() } as any;
    await act(async () => root.render(<ChatComposer chat={chat} />));
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { items, files: [] } });
    await act(async () => {
      textarea.dispatchEvent(event);
    });
    act(() => root.unmount());
    return event.defaultPrevented;
  }

  it("a pasted audio file is consumed: its filename never lands in the draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ transcript: "x" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const memo = new File(["x"], "memo.m4a", { type: "audio/x-m4a" });
    const prevented = await paste([{ kind: "file", type: "audio/x-m4a", getAsFile: () => memo }]);
    expect(fetchMock, "the paste reached transcription").toHaveBeenCalledWith("/api/ai/chat/audio-transcribe", expect.anything());
    expect(prevented).toBe(true);
  });

  it("CONTROL: a plain text paste goes through untouched", async () => {
    expect(await paste([{ kind: "string", type: "text/plain", getAsFile: () => null }])).toBe(false);
  });

  it("CONTROL: a picked image still attaches inline and calls no transcription", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:preview");
    URL.revokeObjectURL = vi.fn(); // jsdom has none; the hook revokes previews on unmount

    await pick(new File(["x"], "shot.png", { type: "image/png" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
