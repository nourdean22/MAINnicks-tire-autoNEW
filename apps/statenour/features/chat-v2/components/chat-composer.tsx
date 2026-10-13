"use client";

import { FormEvent, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Image as ImageIcon, Mic } from "lucide-react";
import { useChatUiStore } from "../stores/chat-ui-store";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";
import { resolveMentionsWithTimeout } from "../lib/mention-resolution";
import { useImageAttachment } from "@/hooks/use-image-attachment";
import { useAudioTranscribe } from "@/hooks/chat/use-audio-transcribe";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";
import { AttachmentPreview } from "@/components/chat/attachment-preview";
import { ACCEPT_ATTRIBUTE } from "@/lib/media/attachment-policy";
import { VoiceWaveformOverlay } from "@/components/chat/voice-waveform-overlay";
import { SlashCommandDropdown, type SlashCommandAction } from "@/components/chat/slash-command-dropdown";
import { MentionDropdown } from "@/components/chat/mention-dropdown";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { useDraftAutosave } from "@/hooks/use-draft-autosave";
import { isSubmitEnter } from "../lib/submit-enter";

/** 09-F12 · put a draft saved before a reload back, never over text already
 *  in the composer (a deep-link prefill lands first). */
export function restoreComposerDraft({
  restore,
  currentDraft,
  setDraft,
}: {
  restore: () => string | null;
  currentDraft: string;
  setDraft: (draft: string) => void;
}): void {
  const saved = restore();
  if (saved?.trim() && !currentDraft.trim()) setDraft(saved);
}

const COARSE_POINTER = "(pointer: coarse)";

// Module scope on purpose: useSyncExternalStore re-subscribes whenever the
// subscribe function changes, so an inline one re-added the listener every render.
function subscribeCoarsePointer(onChange: () => void): () => void {
  const query = window.matchMedia?.(COARSE_POINTER);
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}
const readCoarsePointer = () => window.matchMedia?.(COARSE_POINTER).matches ?? false;
const serverCoarsePointer = () => false;

/** 09-F10 · phones and tablets: Enter is a newline there. The server render
 *  (and hydration) assumes a fine pointer, then the real value takes over. */
function useCoarsePointer(): boolean {
  return useSyncExternalStore(subscribeCoarsePointer, readCoarsePointer, serverCoarsePointer);
}

function messageText(message: { parts?: Array<{ type?: string; text?: string }> }): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

export function ChatComposer({ chat }: { chat: ChatRuntimeController }) {
  const draft = useChatUiStore((s) => s.draft);
  const setDraft = useChatUiStore((s) => s.setDraft);
  const editingMessageId = useChatUiStore((s) => s.editingMessageId);
  const setEditingMessageId = useChatUiStore((s) => s.setEditingMessageId);
  const draftReplace = useChatUiStore((s) => s.draftReplace);
  const confirmDraftReplace = useChatUiStore((s) => s.confirmDraftReplace);
  const cancelDraftReplace = useChatUiStore((s) => s.cancelDraftReplace);
  const coarsePointer = useCoarsePointer();
  const privateMode = useChatUiStore((s) => s.privateMode);
  // 09-F12 · the draft survives a reload or an iOS PWA eviction. Private Lab
  // leaves no trace: an empty value saves nothing and drops any saved draft.
  const { clearDraft, restore } = useDraftAutosave({ key: "chat-composer", value: privateMode ? "" : draft });
  useEffect(() => {
    restoreComposerDraft({ restore, currentDraft: useChatUiStore.getState().draft, setDraft });
    // Mount only: restore once, before anything is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Edit-resend truncation — the same cascade the long-press delete
  // uses (deleteMessageCascade: target + everything after).
  const deleteMessageMutation = trpc.chat.deleteMessage.useMutation();
  const clearConversationDraft = useChatUiStore((s) => s.clearConversationDraft);
  const enqueuePending = useChatUiStore((s) => s.enqueuePending);
  const updatePending = useChatUiStore((s) => s.updatePending);
  const resolvePending = useChatUiStore((s) => s.resolvePending);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setHistoryDrawerOpen = useChatUiStore((s) => s.setHistoryDrawerOpen);
  const setDiagnosticReport = useChatUiStore((s) => s.setDiagnosticReport);
  // 2026-08-28 · COMPOSER CHIPS REMOVED (operator directive).
  // Gone: posture · depth · turbo · private · the global read/rate
  // toggles. Rationale, per control:
  //   · posture/depth — capability dials. Choosing "how much thinking"
  //     per message is the system's job, not a tax on the operator.
  //   · turbo — provably DEAD, not merely redundant: it armed
  //     providerOverride:"anthropic", and ANTHROPIC_API_KEY is absent
  //     from every env (local + Railway), so it silently degraded to
  //     the normal chain every time. A dead control that looks alive is
  //     this repo's signature defect; it does not get to keep living.
  //   · private — removed by operator decision; everything persists.
  //   · read/rate — read-aloud belongs ON the message being read, not
  //     on the composer. It moved to the per-message action row.
  // The store fields survive at their defaults so the transport
  // contract is untouched by this UI-only pass; the routing pass owns
  // deleting them for real.

  const router = useRouter();
  const utils = trpc.useUtils();
  const createPin = trpc.brain.createPin.useMutation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    };
  }, []);

  /**
   * Autosize · 2026-08-29, restored 2026-08-30 (review P2).
   *
   * This effect must re-measure on RESIZE, not only on `draft` change.
   * Measured on a 390x844 viewport: with a draft-only dependency the
   * effect runs once on mount, before layout has settled, so
   * scrollHeight is measured against an unconstrained width, wraps to
   * many lines, and clamps to 200 — an EMPTY textarea carried inline
   * `height: 200px`, making the composer 276px, 32% of the viewport,
   * pushing the last message off screen ("text clipped behind the
   * composer"). The wrong height then latched until the operator typed.
   *
   * The fix is re-measuring on resize, NOT special-casing the empty
   * draft. Observe the PARENT: the textarea's own box is what we
   * mutate, so observing it would re-enter on every write.
   */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;

    // The cap is a share of the visible viewport, not a fixed 200px. With the
    // phone keyboard up, 200px of textarea plus the chrome left the message
    // list a few pixels tall: nothing could be read or scrolled.
    const resize = () => {
      const visible = window.visualViewport?.height ?? window.innerHeight;
      const cap = Math.max(44, Math.min(200, Math.floor(visible * 0.25)));
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, cap)}px`;
    };

    resize();
    if (typeof ResizeObserver === "undefined") return;
    const parent = el.parentElement;
    if (!parent) return;
    const ro = new ResizeObserver(resize);
    ro.observe(parent);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      ro.disconnect();
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [draft]);

  // 04-X1: an audio pick, paste or drop is transcribed into the draft (the
  // operator reads it before sending) instead of riding along as bytes.
  const onTranscript = useCallback(
    (text: string) => {
      const current = useChatUiStore.getState().draft;
      setDraft(current.trim() ? `${current.trimEnd()} ${text}` : text);
    },
    [setDraft],
  );
  const { handleAudioAttach } = useAudioTranscribe({ onTranscript });
  // Set when a paste was handed to transcription, so onPaste can drop the file's name from the draft.
  const audioTakenRef = useRef(false);
  const onAudio = useCallback(
    // shortcut: handleAudioAttach takes an input event and reads only target.files[0]; give it a File signature when that hook is next edited.
    (file: File) => {
      audioTakenRef.current = true;
      void handleAudioAttach({ target: { files: [file], value: "" } } as unknown as React.ChangeEvent<HTMLInputElement>);
    },
    [handleAudioAttach],
  );
  const {
    attached: imgAttached,
    fileInputRef: imgFileInputRef,
    cameraInputRef: imgCameraInputRef,
    handleFileChange: handleImgFileChange,
    clear: clearImg,
    openGallery: openImgGallery,
    readAsBase64: readImgAsBase64,
    attachFromPaste: attachImgFromPaste,
    attachFromDrop: attachImgFromDrop,
  } = useImageAttachment({ onAudio });
  // BDN-314 · drag-and-drop. Depth-counted because dragenter/dragleave
  // fire for every child element crossed — a naive boolean flickers the
  // highlight off the moment the pointer moves over the textarea.
  const [dragDepth, setDragDepth] = useState(0);
  const slash = useSlashCommands();
  const mentions = useMentionSuggestions();

  const sendOrQueue = async (textToSend: string) => {
    if (!textToSend.trim() && !imgAttached) return;

    // 2026-08-18 · edit-resend. When the draft came from tapping an
    // existing user message, sending REPLACES that turn: truncate the
    // client thread at the edited message, cascade-delete it server-side
    // (deleteMessageCascade — the id resolves by row id OR the
    // client-minted UUID a just-sent message still carries), then fall
    // through to a normal send, which regenerates from that point. On
    // cascade failure everything reverts — the original stays, the
    // draft stays, and the failure is loud. This restores the V1
    // contract ("saving will resend the message, retriggering a
    // regeneration") that the chat-v2 migration dropped.
    if (editingMessageId) {
      const editId = editingMessageId;
      setEditingMessageId(null);
      const idx = chat.messages.findIndex((m) => m.id === editId);
      // idx < 0 = the message isn't in this thread anymore (stale arm)
      // — self-heal by falling through to a plain send.
      if (idx >= 0) {
        const prevMessages = chat.messages;
        chat.setMessages(prevMessages.slice(0, idx));
        try {
          await deleteMessageMutation.mutateAsync({ messageId: editId });
        } catch (error) {
          chat.setMessages(prevMessages);
          setEditingMessageId(editId);
          setDraft(textToSend);
          toast.error(
            `Couldn't replace the message, original kept. ${error instanceof Error ? error.message : "Retry."}`,
            { duration: 4000 },
          );
          return;
        }
      }
    }

    const tempId = crypto.randomUUID();
    const isImageAttached = Boolean(imgAttached);
    const hasMentions = textToSend.includes("@");

    // The operator sees the send immediately. Context resolution is bounded
    // and updates this same pending bubble instead of leaving a dead composer.
    enqueuePending({
      tempId,
      conversationId: null,
      text: textToSend,
      createdAt: Date.now(),
      status: hasMentions ? "resolving-context" : "sending",
    });
    clearConversationDraft();
    // Now, not after the autosave debounce: a reload inside that window would
    // bring back a message that was already sent. A failed send re-sets it.
    clearDraft();

    const resolution = await resolveMentionsWithTimeout({
      text: textToSend,
      resolveAsync: mentions.expandMentionsAsync,
      resolveSync: mentions.expandMentions,
    });
    const resolvedText = resolution.text;
    updatePending(tempId, { text: resolvedText, status: "sending" });
    if (resolution.timedOut) {
      toast("Live context took too long, so it went with local context instead", { duration: 2500 });
    }

    try {
      let sendPromise: Promise<void> | void;
      // 2026-08-25 · the BDN-319 video upload lane was removed with the
      // VideoDB retirement — decideAttachment refuses video at attach
      // time now, so no send-time branch is needed.
      if (isImageAttached) {
        const result = await readImgAsBase64();
        if (result) {
          const parts: Array<
            | { type: "text"; text: string }
            | { type: "file"; mediaType: string; url: string; filename: string }
          > = [];
          if (resolvedText) parts.push({ type: "text", text: resolvedText });
          parts.push({
            type: "file",
            mediaType: result.mimeType,
            url: `data:${result.mimeType};base64,${result.base64}`,
            filename: imgAttached!.file.name,
          });
          sendPromise = chat.append({
            id: tempId,
            role: "user",
            content: resolvedText,
            parts,
          });
          clearImg();
        } else {
          toast.error("Couldn't read the attachment. Sending text only.", { duration: 3000 });
          sendPromise = chat.sendText(resolvedText);
          clearImg();
        }
      } else {
        sendPromise = chat.sendText(resolvedText);
      }

      resolvePending(tempId);
      Promise.resolve(sendPromise).catch((error) => {
        console.error(error);
        setDraft(textToSend);
      });
    } catch (error) {
      console.error(error);
      setDraft(textToSend);
      resolvePending(tempId);
    }
  };

  const handleSlashAction = async (action: SlashCommandAction) => {
    setDraft("");
    slash.close();

    if (action === "new-chat") {
      chat.stop();
      chat.setMessages([]);
      setActiveConversationId(null);
      setDiagnosticReport(null);
      toast.success("New conversation ready", { duration: 1400 });
      return;
    }

    if (action === "history") {
      setHistoryDrawerOpen(true);
      return;
    }

    if (action === "pin-last") {
      const lastAssistant = [...chat.messages].reverse().find((m) => m.role === "assistant");
      const text = lastAssistant ? messageText(lastAssistant) : "";
      if (!text) {
        toast.error("No completed Nick reply to pin");
        return;
      }
      try {
        await createPin.mutateAsync({
          content: text.slice(0, 2000),
          source: "chat",
          label: text.split("\n")[0].slice(0, 80) || "Chat insight",
        });
        toast.success("Pinned to Nick's prompt");
      } catch {
        toast.error("Couldn't pin that reply");
      }
      return;
    }

    if (action === "diagnose") {
      setDiagnosticReport("Running independent chat diagnostic…");
      try {
        const result = await utils.system.diagnoseChat.fetch();
        setDiagnosticReport(result.report);
        toast[result.ok ? "success" : "error"](
          result.ok ? "Chat diagnostic passed" : "Chat diagnostic found degradation",
        );
      } catch {
        setDiagnosticReport("# Chat diagnostic\n\nThe independent diagnostic request failed before returning a report.");
        toast.error("Diagnostic request failed");
      }
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.trim() && !imgAttached) return;
    await sendOrQueue(draft.trim());
  };

  const voice = useVoiceInput(
    (text: string) => {
      setDraft(draft ? `${draft} ${text}` : text);
      textareaRef.current?.focus();
    },
    (text: string) => {
      void sendOrQueue(text);
    },
  );

  return (
    <form
      onSubmit={onSubmit}
      // 09-F27-N1: the deep-mode nudge floats over the focused field and could cover Send.
      data-no-deep-nudge=""
      className={`relative mx-auto flex w-full max-w-4xl flex-col gap-2 ${
        dragDepth > 0 ? "rounded-overlay outline-dashed outline-2 outline-offset-4 outline-fg-tertiary" : ""
      }`}
      onDragEnter={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragDepth((d) => d + 1);
      }}
      onDragOver={(e) => {
        // Without preventDefault the browser navigates to the dropped
        // file and the whole chat is replaced by it.
        if (e.dataTransfer?.types?.includes("Files")) e.preventDefault();
      }}
      onDragLeave={() => setDragDepth((d) => Math.max(0, d - 1))}
      onDrop={(e) => {
        if (!e.dataTransfer?.types?.includes("Files")) return;
        e.preventDefault();
        setDragDepth(0);
        attachImgFromDrop(e);
      }}
    >
      {/* 2026-08-18 · edit-resend banner. Editing is armed by the Edit
          button on a sent message (2026-08-28: promoted out of the
          long-press sheet into the visible per-message action row), or
          by tapping the bubble. Either way it must be VISIBLE and
          cancellable — an invisible armed cascade-delete would be a
          destructive surprise. */}
      {editingMessageId && (
        <div className="flex items-center justify-between gap-2 rounded-control border border-accent/40 bg-accent-soft pl-3 text-[12px] text-accent">
          <span className="min-w-0 truncate">
            Editing a sent message. Sending replaces it and everything after it.
          </span>
          {/* 09-F21: was px-2 py-0.5 (about 22px tall); the Replace draft? banner below is the pattern. */}
          <button
            type="button"
            onClick={() => {
              setEditingMessageId(null);
              setDraft("");
            }}
            className="min-h-11 shrink-0 rounded-control px-3 text-[12px] font-medium transition-colors duration-[var(--motion-state)] hover:bg-accent-medium"
          >
            Cancel
          </button>
        </div>
      )}
      {/* 09-F11 · a tap on a sent message, its Edit button, or a suggestion
          link never overwrites typed text in one go: the second tap is here.
          In-DOM, because window.confirm is silently suppressed in the iOS PWA.
          Focus lands on Keep draft, the choice that loses nothing. */}
      {draftReplace && (
        <div
          role="group"
          aria-label="Replace draft?"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelDraftReplace();
              textareaRef.current?.focus();
            }
          }}
          className="flex items-center justify-between gap-2 rounded-control border border-edge-default bg-surface pl-3 text-[12px] text-fg-secondary"
        >
          <span className="min-w-0 truncate">Replace draft?</span>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => {
                confirmDraftReplace();
                textareaRef.current?.focus();
              }}
              className="min-h-11 rounded-control px-3 font-medium text-fg transition-colors duration-[var(--motion-state)] hover:bg-surface-hover"
            >
              Replace
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => {
                cancelDraftReplace();
                textareaRef.current?.focus();
              }}
              className="min-h-11 rounded-control px-3 font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:bg-surface-hover hover:text-fg"
            >
              Keep draft
            </button>
          </div>
        </div>
      )}
      {slash.show && (
        <SlashCommandDropdown
          filtered={slash.filtered}
          onNavigate={(path) => {
            slash.close();
            setDraft("");
            router.push(path);
          }}
          onAction={(action) => void handleSlashAction(action)}
          onPromptFill={(prompt) => {
            setDraft(prompt);
            slash.close();
            textareaRef.current?.focus();
          }}
          onPromptFire={(prompt) => {
            void sendOrQueue(prompt);
            slash.close();
          }}
          onClose={slash.close}
        />
      )}

      {mentions.show && !slash.show && (
        <MentionDropdown
          filtered={mentions.filtered}
          onPick={(mention) => {
            const current = draft;
            const caret = textareaRef.current?.selectionStart ?? current.length;
            const before = current.slice(0, caret);
            const after = current.slice(caret);
            const atIndex = before.lastIndexOf("@");
            if (atIndex !== -1) {
              const token = mention.label.startsWith("@") ? mention.label : `@${mention.label}`;
              const nextBefore = `${before.slice(0, atIndex)}${token} `;
              setDraft(nextBefore + after);
              if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
              mentionTimerRef.current = setTimeout(() => {
                mentionTimerRef.current = null;
                textareaRef.current?.setSelectionRange(nextBefore.length, nextBefore.length);
                textareaRef.current?.focus();
              }, 0);
            }
            mentions.close();
          }}
        />
      )}

      {imgAttached && (
        <div className="mb-1 overflow-hidden rounded-float border border-edge-subtle bg-surface">
          <AttachmentPreview file={imgAttached.file} preview={imgAttached.preview} onClear={clearImg} />
        </div>
      )}

      {/* UI v2 (2026-10-01): the composer is control chrome, so it gets the translucent material
          (docs/design/ui-v2/SYSTEM.md §11). Focus = one accent edge + an L1 lift; the textarea also
          keeps the base :focus-visible ring (base.css is unlayered, so no utility can remove it). */}
      <div className="ui-material relative flex items-end gap-1.5 rounded-overlay border border-edge-default p-1.5 transition-[border-color,box-shadow] duration-[var(--motion-state)] ease-[var(--ease-standard)] focus-within:border-accent/60 focus-within:shadow-l1">
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={openImgGallery} className="flex h-11 w-11 items-center justify-center rounded-control text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:bg-surface-interactive hover:text-fg" aria-label="Attach image, audio or PDF">
            <ImageIcon size={18} />
          </button>
          <button
            type="button"
            onClick={voice.isRecording || voice.continuous ? voice.stopRecording : voice.startRecording}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-control transition-colors duration-[var(--motion-state)]",
              voice.isRecording || voice.continuous
                ? "bg-rose-500/15 text-rose-300"
                : "text-fg-tertiary hover:bg-surface-interactive hover:text-fg",
            )}
            aria-label="Voice input"
          >
            <Mic size={18} />
          </button>
        </div>

        <input type="file" ref={imgFileInputRef} onChange={handleImgFileChange} className="hidden" accept={ACCEPT_ATTRIBUTE} title="Attach an image, audio file or PDF" />
        <input type="file" ref={imgCameraInputRef} onChange={handleImgFileChange} className="hidden" accept="image/*" capture="environment" title="Capture image from camera" />

        <div className="relative flex-1">
          {(voice.isRecording || voice.continuous) && <VoiceWaveformOverlay audioLevel={voice.audioLevel} mode={voice.continuous ? "continuous" : "recording"} />}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => {
              const value = event.target.value;
              setDraft(value);
              slash.onInputChange(value);
              mentions.onInputChange(value, event.target.selectionStart ?? value.length);
            }}
            onPaste={(event) => {
              audioTakenRef.current = false;
              if (attachImgFromPaste(event)) {
                event.preventDefault();
                toast.success("Image attached from clipboard", { duration: 1500 });
              } else if (audioTakenRef.current) {
                event.preventDefault();
              }
            }}
            onKeyDown={(event) => {
              // 09-F9/F10 · IME confirm never sends; on a phone Enter is a newline.
              if (isSubmitEnter(event, { coarsePointer })) {
                event.preventDefault();
                if (chat.isStreaming) {
                  // Was swallowed without a word.
                  toast("Nick is still replying. Stop the reply to send this.", { id: "composer-busy", duration: 3000 });
                } else if (draft.trim() || imgAttached) {
                  void sendOrQueue(draft.trim());
                }
              }
              // Escape disarms edit-resend (keeps the draft text — the
              // operator may want it as a NEW message instead).
              if (event.key === "Escape" && editingMessageId) {
                event.preventDefault();
                setEditingMessageId(null);
              }
            }}
            placeholder="Ask, analyze, create, or tell Nick to act…"
            enterKeyHint={coarsePointer ? "enter" : "send"}
            className="max-h-[200px] min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-[16px] leading-[1.5] text-fg outline-none placeholder:text-fg-tertiary"
            rows={1}
          />
        </div>

        {chat.isStreaming ? (
          <button type="button" aria-label="Stop generating" onClick={chat.stopTurn} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-rose-500/90 text-white transition-colors hover:bg-rose-500">
            <span className="block h-3 w-3 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button type="submit" aria-label="Send message" disabled={!draft.trim() && !imgAttached} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-accent text-[var(--text-inverse)] transition-colors duration-[var(--motion-micro)] hover:bg-accent-hover disabled:opacity-40">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
