"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Image as ImageIcon, Mic } from "lucide-react";
import { useChatUiStore } from "../stores/chat-ui-store";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";
import { resolveMentionsWithTimeout } from "../lib/mention-resolution";
import { useImageAttachment } from "@/hooks/use-image-attachment";
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
  const clearConversationDraft = useChatUiStore((s) => s.clearConversationDraft);
  const enqueuePending = useChatUiStore((s) => s.enqueuePending);
  const updatePending = useChatUiStore((s) => s.updatePending);
  const resolvePending = useChatUiStore((s) => s.resolvePending);
  const setActiveConversationId = useChatUiStore((s) => s.setActiveConversationId);
  const setHistoryDrawerOpen = useChatUiStore((s) => s.setHistoryDrawerOpen);
  const setDiagnosticReport = useChatUiStore((s) => s.setDiagnosticReport);
  // 2026-07-22 · authority-kernel controls
  const privateMode = useChatUiStore((s) => s.privateMode);
  const setPrivateMode = useChatUiStore((s) => s.setPrivateMode);
  const turbo = useChatUiStore((s) => s.turbo);
  const setTurbo = useChatUiStore((s) => s.setTurbo);
  const posture = useChatUiStore((s) => s.posture);
  const setPosture = useChatUiStore((s) => s.setPosture);
  const depth = useChatUiStore((s) => s.depth);
  const setDepth = useChatUiStore((s) => s.setDepth);
  const actionPermission = useChatUiStore((s) => s.actionPermission);
  const setActionPermission = useChatUiStore((s) => s.setActionPermission);

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

  useEffect(() => {
    if (!textareaRef.current) return;
    textareaRef.current.style.height = "auto";
    textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
  }, [draft]);

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
  } = useImageAttachment();
  // BDN-314 · drag-and-drop. Depth-counted because dragenter/dragleave
  // fire for every child element crossed — a naive boolean flickers the
  // highlight off the moment the pointer moves over the textarea.
  const [dragDepth, setDragDepth] = useState(0);
  const slash = useSlashCommands();
  const mentions = useMentionSuggestions();

  const sendOrQueue = async (textToSend: string) => {
    if (!textToSend.trim() && !imgAttached) return;

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

    const resolution = await resolveMentionsWithTimeout({
      text: textToSend,
      resolveAsync: mentions.expandMentionsAsync,
      resolveSync: mentions.expandMentions,
    });
    const resolvedText = resolution.text;
    updatePending(tempId, { text: resolvedText, status: "sending" });
    if (resolution.timedOut) {
      toast("Live context took too long — sent with local context instead", { duration: 2500 });
    }

    try {
      let sendPromise: Promise<void> | void;
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
          toast.error("Couldn't read the attachment — sending text only.", { duration: 3000 });
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

  // UI-1 (2026-07-28): the pills used to CYCLE on tap — the operator had
  // to memorize the rotation order and guess each value's meaning. Now a
  // tap opens an explicit in-DOM control sheet (iOS-PWA primitive — no
  // native popovers) with every option labeled and described; the pill
  // is just the collapsed state.
  const POSTURES = ["auto", "execute", "counsel", "spar"] as const;
  const DEPTHS = ["auto", "standard", "deep"] as const;
  const PERMISSIONS = ["draft", "read", "execute"] as const;
  const [openControl, setOpenControl] = useState<null | "posture" | "depth" | "actions">(null);

  const CONTROL_OPTIONS: Record<
    "posture" | "depth" | "actions",
    { title: string; options: Array<{ value: string; label: string; hint: string }> }
  > = {
    posture: {
      title: "Posture — how Nick engages",
      options: [
        { value: "auto", label: "Auto", hint: "Nick picks the stance per message" },
        { value: "execute", label: "Execute", hint: "Direct — do the thing, minimal debate" },
        { value: "counsel", label: "Counsel", hint: "Advise with options before acting" },
        { value: "spar", label: "Spar", hint: "Challenge my thinking, push back hard" },
      ],
    },
    depth: {
      title: "Depth — how much thinking",
      options: [
        { value: "auto", label: "Auto", hint: "Nick chooses per question" },
        { value: "standard", label: "Standard", hint: "Fast, focused answer" },
        { value: "deep", label: "Deep", hint: "Slower, thorough multi-step analysis" },
      ],
    },
    actions: {
      title: "Permission — what Nick may do",
      options: [
        { value: "draft", label: "Draft only", hint: "Answer and prepare — nothing runs" },
        { value: "read", label: "Read data", hint: "May read connected business data" },
        { value: "execute", label: "Execute", hint: "May run approved actions (receipts always)" },
      ],
    },
  };

  const applyControl = (control: "posture" | "depth" | "actions", value: string) => {
    if (control === "posture") setPosture(value as (typeof POSTURES)[number]);
    else if (control === "depth") setDepth(value as (typeof DEPTHS)[number]);
    else setActionPermission(value as (typeof PERMISSIONS)[number]);
    setOpenControl(null);
  };

  return (
    <form
      onSubmit={onSubmit}
      className={`relative mx-auto flex w-full max-w-4xl flex-col gap-2 ${
        dragDepth > 0 ? "rounded-xl outline-dashed outline-2 outline-offset-4 outline-fg-tertiary" : ""
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
      {privateMode && (
        <div className="flex flex-wrap items-center justify-center gap-2 rounded-xl border border-gold/40 bg-gold/10 px-3 py-1.5 text-center text-[11px] font-semibold uppercase tracking-widest text-gold" data-testid="private-lab-banner">
          Private Lab · no history · no memory · no learning · provider retention applies
        </div>
      )}
      <div className="flex items-center gap-1.5 px-1" data-testid="authority-controls">
        <button
          type="button"
          onClick={() => setOpenControl(openControl === "posture" ? null : "posture")}
          aria-label={`Posture: ${posture} (tap to choose)`}
          aria-expanded={openControl === "posture"}
          className={cn(
            "flex min-h-11 items-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wider transition",
            posture === "auto"
              ? "border-glass text-fg-tertiary hover:text-fg-secondary"
              : posture === "spar"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                : "border-gold/40 bg-gold/10 text-gold",
          )}
        >
          {posture === "auto" ? "posture" : posture}
        </button>
        <button
          type="button"
          onClick={() => setOpenControl(openControl === "depth" ? null : "depth")}
          aria-label={`Depth: ${depth} (tap to choose)`}
          aria-expanded={openControl === "depth"}
          className={cn(
            "flex min-h-11 items-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wider transition",
            depth === "auto" ? "border-glass text-fg-tertiary hover:text-fg-secondary" : "border-gold/40 bg-gold/10 text-gold",
          )}
        >
          {depth === "auto" ? "depth" : depth}
        </button>
        <button
          type="button"
          onClick={() => setOpenControl(openControl === "actions" ? null : "actions")}
          aria-label={`Action permission: ${actionPermission} (tap to choose)`}
          aria-expanded={openControl === "actions"}
          className={cn(
            "flex min-h-11 items-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wider transition",
            actionPermission === "draft"
              ? "border-glass text-fg-tertiary hover:text-fg-secondary"
              : actionPermission === "read"
                ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                : "border-gold/40 bg-gold/10 text-gold",
          )}
        >
          {actionPermission === "draft" ? "actions" : actionPermission}
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setTurbo(!turbo)}
          aria-label={turbo ? "Turbo armed for the next message (tap to disarm)" : "Turbo off (tap to arm one message on the external model)"}
          className={cn(
            "flex min-h-11 items-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wider transition",
            turbo ? "border-amber-500/60 bg-amber-500/15 text-amber-300" : "border-glass text-fg-tertiary hover:text-fg-secondary",
          )}
        >
          {turbo ? "turbo · armed" : "turbo"}
        </button>
        <button
          type="button"
          onClick={() => setPrivateMode(!privateMode)}
          aria-label={privateMode ? "Private Lab on (tap to turn off)" : "Private Lab off (tap to turn on)"}
          className={cn(
            "flex min-h-11 items-center rounded-lg border px-3 text-[10px] font-semibold uppercase tracking-wider transition",
            privateMode ? "border-gold/60 bg-gold/15 text-gold" : "border-glass text-fg-tertiary hover:text-fg-secondary",
          )}
        >
          {privateMode ? "private · on" : "private"}
        </button>
      </div>
      {openControl && (() => {
        const sheet = CONTROL_OPTIONS[openControl];
        return (
        <div
          className="rounded-xl border border-glass bg-elevated p-3 space-y-1.5"
          data-testid={`control-sheet-${openControl}`}
          role="listbox"
          aria-label={sheet.title}
        >
          <div className="flex items-center justify-between pb-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-fg-secondary">
              {sheet.title}
            </p>
            <span className="text-[10px] text-fg-tertiary">this conversation</span>
          </div>
          {sheet.options.map((opt) => {
            const current =
              openControl === "posture" ? posture : openControl === "depth" ? depth : actionPermission;
            const selected = current === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => applyControl(openControl, opt.value)}
                className={cn(
                  "flex w-full items-baseline gap-2 rounded-lg border px-3 py-2 text-left transition",
                  selected
                    ? "border-gold/50 bg-gold/10"
                    : "border-transparent hover:border-glass hover:bg-white/[0.03]",
                )}
              >
                <span className={cn("text-[12px] font-semibold", selected ? "text-gold" : "text-fg-secondary")}>
                  {opt.label}
                </span>
                <span className="text-[11px] text-fg-tertiary">{opt.hint}</span>
                {selected && <span className="ml-auto text-[10px] text-gold">current</span>}
              </button>
            );
          })}
        </div>
        );
      })()}
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
        <div className="mb-1 overflow-hidden rounded-2xl border border-edge bg-raised">
          <AttachmentPreview file={imgAttached.file} preview={imgAttached.preview} onClear={clearImg} />
        </div>
      )}

      <div className="relative flex items-end gap-2 rounded-2xl border border-glass bg-raised/80 p-2 shadow-2xl transition focus-within:border-gold/40 focus-within:ring-2 focus-within:ring-gold/10">
        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          <button type="button" onClick={openImgGallery} className="flex h-11 w-11 items-center justify-center rounded-xl text-fg-secondary hover:bg-elevated hover:text-fg" aria-label="Attach image, audio or PDF">
            <ImageIcon size={18} />
          </button>
          <button
            type="button"
            onClick={voice.isRecording || voice.continuous ? voice.stopRecording : voice.startRecording}
            className={cn(
              "flex h-11 w-11 items-center justify-center rounded-xl transition",
              voice.isRecording || voice.continuous
                ? "border border-red-500/30 bg-red-500/20 text-red-400"
                : "text-fg-secondary hover:bg-elevated hover:text-fg",
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
              if (attachImgFromPaste(event)) {
                event.preventDefault();
                toast.success("Image attached from clipboard", { duration: 1500 });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!chat.isStreaming && (draft.trim() || imgAttached)) void sendOrQueue(draft.trim());
              }
            }}
            placeholder="Ask, analyze, create, or tell Nick to act…"
            className="max-h-[200px] min-h-11 w-full resize-none bg-transparent px-2 py-2.5 text-[16px] text-fg outline-none placeholder:text-fg-tertiary"
            rows={1}
          />
        </div>

        {chat.isStreaming ? (
          <button type="button" aria-label="Stop generating" onClick={chat.stop} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-500/90 text-white">
            <span className="block h-3 w-3 rounded-[3px] bg-current" />
          </button>
        ) : (
          <button type="submit" aria-label="Send message" disabled={!draft.trim() && !imgAttached} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold text-black transition disabled:opacity-40">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
            </svg>
          </button>
        )}
      </div>
    </form>
  );
}
