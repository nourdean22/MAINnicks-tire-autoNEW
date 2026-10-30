/**
 * 2026-10-30 · U4a: the header mic drives the composer's dictation.
 *
 * It used to open OpenAI Realtime; the prod key answers 401, so the header mic failed every time.
 * Now the header toggle (chat-ui-store isVoiceDocked) starts and stops the composer's own
 * dictation, a dictation that ends on its own releases the header toggle, and a pending
 * transcription is shown in words.
 */
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), transcribing: false, startOk: true }));

vi.mock("@/hooks/use-voice-input", async () => {
  const { useState } = await import("react");
  return {
    useVoiceInput: () => {
      const [rec, setRec] = useState(false);
      return {
        isRecording: rec,
        transcribing: h.transcribing,
        continuous: false,
        audioLevel: 0,
        startRecording: async () => { h.start(); if (h.startOk) setRec(true); return h.startOk; },
        stopRecording: () => { h.stop(); setRec(false); },
        startContinuous: async () => {},
        stopContinuous: () => {},
        mediaRecorderRef: { current: null },
      };
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    useUtils: () => ({}),
    brain: { createPin: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
    chat: { deleteMessage: { useMutation: () => ({ mutateAsync: async () => ({}), isPending: false }) } },
  },
}));
vi.mock("@/hooks/use-draft-autosave", () => ({
  useDraftAutosave: () => ({ clearDraft: () => {}, restore: () => null }),
}));

import { ChatComposer } from "@/features/chat-v2/components/chat-composer";
import { useChatUiStore } from "@/features/chat-v2/stores/chat-ui-store";

const chat = { status: "ready", isStreaming: false, messages: [], sendText: vi.fn(), append: vi.fn() } as any;
let root: Root | null = null;
let host: HTMLDivElement;

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<ChatComposer chat={chat} />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  h.start.mockClear();
  h.stop.mockClear();
  h.transcribing = false;
  h.startOk = true;
  useChatUiStore.setState({ isVoiceDocked: false, draft: "" });
});

describe("header mic -> composer dictation", () => {
  it("turning the header mic on starts dictation; turning it off stops it", async () => {
    mount();
    expect(h.start).not.toHaveBeenCalled();

    await act(async () => { useChatUiStore.getState().toggleVoiceDock(); });
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(useChatUiStore.getState().isVoiceDocked).toBe(true);

    await act(async () => { useChatUiStore.getState().toggleVoiceDock(); });
    expect(h.stop).toHaveBeenCalled();
    expect(useChatUiStore.getState().isVoiceDocked).toBe(false);
  });

  it("a start that fails (mic denied) releases the header mic instead of leaving it on", async () => {
    h.startOk = false;
    mount();
    await act(async () => { useChatUiStore.getState().toggleVoiceDock(); });
    expect(h.start).toHaveBeenCalledTimes(1);
    expect(useChatUiStore.getState().isVoiceDocked).toBe(false);
  });

  it("leaving the chat mid-dictation releases the header mic, so the next mount starts nothing", async () => {
    mount();
    await act(async () => { useChatUiStore.getState().toggleVoiceDock(); });
    act(() => root?.unmount());
    root = null;
    expect(useChatUiStore.getState().isVoiceDocked).toBe(false);
    h.start.mockClear();
    mount();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("stopping from the composer mic releases the header mic", async () => {
    mount();
    await act(async () => { useChatUiStore.getState().toggleVoiceDock(); });
    const mic = host.querySelector('button[aria-label="Voice input"]') as HTMLButtonElement;
    await act(async () => { mic.click(); });

    expect(h.stop).toHaveBeenCalled();
    expect(useChatUiStore.getState().isVoiceDocked).toBe(false);
  });

  it("CONTROL: mounting with the header mic off starts nothing", () => {
    mount();
    expect(h.start).not.toHaveBeenCalled();
  });

  it("a pending transcription is shown in words", () => {
    h.transcribing = true;
    mount();
    expect(host.textContent).toContain("Transcribing your voice");
  });
});
