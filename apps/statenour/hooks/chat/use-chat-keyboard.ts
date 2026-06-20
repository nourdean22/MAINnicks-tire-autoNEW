"use client";

/**
 * useChatKeyboard — B2 · extract the 125-line global keyboard handler
 * from app/(mastery)/chat/page.tsx.
 *
 * Lives here so the chat page body can focus on layout + state. The
 * shortcut matrix stays identical:
 *
 *   Cmd/Ctrl + K              focus input
 *   Cmd/Ctrl + F              toggle history search (Shift if input focused)
 *   Cmd/Ctrl + /              toggle help overlay
 *   Cmd/Ctrl + I              toggle system-prompt inspector
 *   Cmd/Ctrl + Shift + L      toggle tool-call log panel
 *   Cmd/Ctrl + Shift + D      force DEEP mode for next message
 *   Cmd/Ctrl + Shift + V      cycle provider override
 *   Cmd/Ctrl + Shift + P      jump to /brain#pinned-context
 *   Cmd/Ctrl + Shift + T      toggle TTS
 *   Cmd/Ctrl + Shift + E      export conversation as text
 *   Escape                    stop streaming > close search > close help >
 *                             dismiss error > close history
 *
 * Inputs are passed as a props object — the hook doesn't own any state
 * itself, just wires the keyboard event to existing setters/callbacks.
 */

import { useEffect, useRef, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { useRouter } from "next/navigation";
import type { ChatOverrides, ProviderOverride } from "@/lib/chat/types";

type Router = ReturnType<typeof useRouter>;

interface Haptic {
  tap: () => void;
  medium: () => void;
}

interface Tts {
  toggle: () => void;
}

export interface ChatMessagePart {
  type: string;
  text?: string;
}

export interface ChatMessage {
  role: string;
  parts?: ChatMessagePart[];
}

export interface UseChatKeyboardOpts {
  inputRef: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  isStreaming: boolean;
  stop: () => void;
  messages: ChatMessage[];
  // overlay toggles
  setShowHistorySearch: Dispatch<SetStateAction<boolean>>;
  setShowHelp: Dispatch<SetStateAction<boolean>>;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
  setToolLogOpen: Dispatch<SetStateAction<boolean>>;
  // override controls
  setOverrides: Dispatch<SetStateAction<ChatOverrides>>;
  // TTS / router / haptics
  tts: Tts;
  haptic: Haptic;
  router: Router;
  // esc-stack deps
  showHelp: boolean;
  showHistory: boolean;
  showHistorySearch: boolean;
  error: string | null;
  setError: Dispatch<SetStateAction<string | null>>;
  setShowHistory: Dispatch<SetStateAction<boolean>>;
}

export function useChatKeyboard(opts: UseChatKeyboardOpts): void {
  const {
    inputRef,
    isStreaming,
    stop,
    messages,
    setShowHistorySearch,
    setShowHelp,
    setInspectorOpen,
    setToolLogOpen,
    setOverrides,
    tts,
    haptic,
    router,
    showHelp,
    showHistory,
    showHistorySearch,
    error,
    setError,
    setShowHistory,
  } = opts;

  // Audit #350 fix · keep latest `messages` in a ref so the window
  // keydown listener doesn't unbind + rebind per token (deps array
  // previously included `messages`, which mutates on every stream
  // chunk). Used only by the Cmd+Shift+E export shortcut.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        return;
      }

      if (mod && e.key === "f") {
        // Only hijack Cmd+F when the chat page is focused — don't block
        // browser's native find inside inputs/textareas.
        const activeTag = (document.activeElement?.tagName || "").toUpperCase();
        if (activeTag !== "INPUT" && activeTag !== "TEXTAREA") {
          e.preventDefault();
          setShowHistorySearch((v) => !v);
          return;
        }
        // Still support the shortcut even while input is focused if
        // combined with Shift — "proper" chat search always available.
        if (e.shiftKey) {
          e.preventDefault();
          setShowHistorySearch((v) => !v);
          return;
        }
      }

      if (mod && e.key === "/") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // Cmd/Ctrl+I → open the system prompt inspector
      if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        setInspectorOpen((v) => !v);
        return;
      }

      // ── Hot keys — power shortcuts for chat controls ──
      // Cmd/Ctrl+Shift+L → toggle tool call log panel
      if (mod && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        haptic.tap();
        setToolLogOpen((v) => !v);
        return;
      }

      // Cmd/Ctrl+Shift+D → force DEEP mode for next message
      if (mod && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        haptic.medium();
        setOverrides((o) => ({
          ...o,
          mode: o.mode === "deep" ? "auto" : "deep",
        }));
        return;
      }

      // Cmd/Ctrl+Shift+V → cycle provider override
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        haptic.medium();
        setOverrides((o) => {
          const chain: ProviderOverride[] = ["auto", "openai", "anthropic"];
          const idx = chain.indexOf(o.provider);
          const next = chain[(idx + 1) % chain.length];
          return { ...o, provider: next };
        });
        return;
      }

      // Cmd/Ctrl+Shift+P → jump to /brain pinned-context section
      if (mod && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        haptic.medium();
        router.push("/brain#pinned-context");
        return;
      }

      // Cmd/Ctrl+Shift+T → toggle TTS
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        haptic.tap();
        tts.toggle();
        return;
      }

      // Cmd/Ctrl+Shift+E → export conversation as text
      if (mod && e.shiftKey && e.key.toLowerCase() === "e") {
        e.preventDefault();
        const m = messagesRef.current;
        if (m.length === 0) return;
        const exported = m
          .map((m) => {
            const role = m.role === "user" ? "Nour" : "Nick";
            const text = (m.parts ?? [])
              .filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
              .map((p) => p.text)
              .join("\n");
            return `[${role}]\n${text}`;
          })
          .join("\n\n---\n\n");
        navigator.clipboard
          ?.writeText(exported)
          .then(() => haptic.tap())
          .catch(() => {});
        return;
      }

      if (e.key === "Escape") {
        if (isStreaming) {
          stop();
          return;
        }
        if (showHistorySearch) {
          setShowHistorySearch(false);
          return;
        }
        if (showHelp) {
          setShowHelp(false);
          return;
        }
        if (error) {
          setError(null);
          return;
        }
        if (showHistory) {
          setShowHistory(false);
          return;
        }
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Same dep list as the original inline handler — setters are stable
    // by React contract so they don't need to be in deps.
  }, [
    isStreaming,
    showHelp,
    error,
    showHistory,
    showHistorySearch,
    stop,
    setShowHistory,
    // The following are refs or stable setters/callbacks; listed here
    // for TS strictness only.
    inputRef,
    // Audit #350 fix · `messages` deliberately omitted · read via
    // messagesRef.current so the window keydown listener doesn't
    // rebind on every stream chunk.
    setShowHistorySearch,
    setShowHelp,
    setInspectorOpen,
    setToolLogOpen,
    setOverrides,
    setError,
    tts,
    haptic,
    router,
  ]);
}
