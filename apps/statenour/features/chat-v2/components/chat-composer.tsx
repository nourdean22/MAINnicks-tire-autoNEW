"use client";

import { FormEvent, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Mic, Image as ImageIcon } from "lucide-react";
import { useChatUiStore } from "../stores/chat-ui-store";
import type { ChatRuntimeController } from "../types/chat-runtime-controller";
import { useImageAttachment } from "@/hooks/use-image-attachment";
import { useVoiceInput } from "@/hooks/use-voice-input";
import { useSlashCommands } from "@/hooks/use-slash-commands";
import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";
import { AttachmentPreview } from "@/components/chat/attachment-preview";
import { VoiceWaveformOverlay } from "@/components/chat/voice-waveform-overlay";
import { SlashCommandDropdown } from "@/components/chat/slash-command-dropdown";
import { MentionDropdown } from "@/components/chat/mention-dropdown";
import { cn } from "@/lib/utils";

export function ChatComposer({ chat }: { chat: ChatRuntimeController }) {
  const draft = useChatUiStore((s) => s.draft);
  const setDraft = useChatUiStore((s) => s.setDraft);
  const clearConversationDraft = useChatUiStore((s) => s.clearConversationDraft);
  const enqueuePending = useChatUiStore((s) => s.enqueuePending);
  const resolvePending = useChatUiStore((s) => s.resolvePending);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mentionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
    };
  }, []);

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [draft]);

  // Intelligence Hooks
  const {
    attached: imgAttached,
    fileInputRef: imgFileInputRef,
    cameraInputRef: imgCameraInputRef,
    handleFileChange: handleImgFileChange,
    clear: clearImg,
    openGallery: openImgGallery,
    readAsBase64: readImgAsBase64,
    attachFromPaste: attachImgFromPaste,
  } = useImageAttachment();
  const slash = useSlashCommands();
  const mentions = useMentionSuggestions();

  const sendOrQueue = async (textToSend: string) => {
    if (!textToSend.trim() && !imgAttached) return;

    const tempId = crypto.randomUUID();
    const isImageAttached = !!imgAttached;

    // Optimistic Enqueue
    enqueuePending({
      tempId,
      conversationId: null,
      text: textToSend,
      createdAt: Date.now(),
    });

    clearConversationDraft();

    try {
      if (isImageAttached) {
        const result = await readImgAsBase64();
        if (result) {
          type SendMessagePart =
            | { type: "text"; text: string }
            | {
                type: "file";
                mediaType: string;
                url: string;
                filename: string;
              };
          const parts: SendMessagePart[] = [];
          if (textToSend) parts.push({ type: "text", text: textToSend });
          parts.push({
            type: "file",
            mediaType: result.mimeType,
            url: result.base64,
            filename: imgAttached!.file.name,
          });

          await chat.append({
            id: tempId,
            role: "user",
            content: textToSend, // Still provide string content for logging/fallbacks
            parts: parts,
          });
          clearImg();
        } else {
          await chat.sendText(textToSend);
        }
      } else {
        await chat.sendText(textToSend);
      }
      resolvePending(tempId);
    } catch (err) {
      console.error(err);
      // Restore on failure
      setDraft(textToSend);
      resolvePending(tempId);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim() && !imgAttached) return;
    await sendOrQueue(draft.trim());
  };

  // Voice Hook
  const voice = useVoiceInput(
    (text: string) => {
      setDraft(draft ? draft + " " + text : text);
      textareaRef.current?.focus();
    },
    (text: string) => {
      sendOrQueue(text);
    }
  );

  return (
    <form onSubmit={onSubmit} className="relative mx-auto flex w-full max-w-4xl flex-col gap-2">
      {/* Above-Composer Dropdowns */}
      {slash.show && (
        <SlashCommandDropdown
          filtered={slash.filtered}
          onNavigate={(path) => {
            // Usually we do router.push(path) but we don't have router here. 
            // In v2 we might just fire action.
            setDraft("");
            slash.close();
          }}
          onAction={(action) => {
            setDraft("");
            slash.close();
            toast(`Action ${action} triggered (coming soon)`);
          }}
          onPromptFill={(prompt) => {
            setDraft(prompt);
            slash.close();
            textareaRef.current?.focus();
          }}
          onPromptFire={(prompt) => {
            sendOrQueue(prompt);
            slash.close();
            textareaRef.current?.focus();
          }}
          onClose={() => slash.close()}
        />
      )}

      {mentions.show && !slash.show && (
        <MentionDropdown
          filtered={mentions.filtered}
          onPick={(m) => {
            const current = draft;
            const start = textareaRef.current?.selectionStart ?? current.length;
            const textBeforeCaret = current.slice(0, start);
            const textAfterCaret = current.slice(start);
            const atIndex = textBeforeCaret.lastIndexOf("@");
            if (atIndex !== -1) {
              const newBefore = textBeforeCaret.slice(0, atIndex) + "@" + m.label + " ";
              setDraft(newBefore + textAfterCaret);
              if (mentionTimerRef.current) clearTimeout(mentionTimerRef.current);
              mentionTimerRef.current = setTimeout(() => {
                mentionTimerRef.current = null;
                const newPos = newBefore.length;
                textareaRef.current?.setSelectionRange(newPos, newPos);
                textareaRef.current?.focus();
              }, 0);
            }
            mentions.close();
          }}
        />
      )}

      {/* Attachment Preview UI */}
      {imgAttached && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden mb-1">
          <AttachmentPreview
            file={imgAttached.file}
            preview={imgAttached.preview}
            onClear={clearImg}
          />
        </div>
      )}

      {/* Main Composer Chrome */}
      <div className="relative flex items-end gap-2 rounded-2xl border border-white/10 bg-zinc-900/60 p-2 shadow-2xl backdrop-blur-2xl transition-all duration-300 focus-within:border-indigo-500/30 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:shadow-[0_0_40px_-10px_rgba(99,102,241,0.15)] hover:bg-zinc-900/80">
        
        {/* Left Toolbar (Minimalist) */}
        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          <button
            type="button"
            onClick={openImgGallery}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition-all duration-300 hover:bg-zinc-800 hover:text-zinc-200 hover:scale-105 active:scale-95"
            aria-label="Attach image"
          >
            <ImageIcon size={18} />
          </button>
          
          <button
            type="button"
            onClick={voice.isRecording || voice.continuous ? voice.stopRecording : voice.startRecording}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl transition-all duration-300 hover:scale-105 active:scale-95",
              voice.isRecording || voice.continuous
                ? "bg-red-500/20 text-red-400 shadow-[0_0_15px_-3px_rgba(239,68,68,0.3)] border border-red-500/30"
                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            )}
            aria-label="Voice input"
          >
            <Mic size={18} />
          </button>
        </div>

        {/* Hidden File Inputs */}
        <input
          type="file"
          ref={imgFileInputRef}
          onChange={handleImgFileChange}
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.txt"
          title="Attach image from gallery"
        />
        <input
          type="file"
          ref={imgCameraInputRef}
          onChange={handleImgFileChange}
          className="hidden"
          accept="image/*"
          capture="environment"
          title="Capture image from camera"
        />

        {/* Textarea Area */}
        <div className="flex-1 relative">
          {(voice.isRecording || voice.continuous) && (
            <VoiceWaveformOverlay
              audioLevel={voice.audioLevel}
              mode={voice.continuous ? "continuous" : "recording"}
            />
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              const val = e.target.value;
              setDraft(val);
              slash.onInputChange(val);
              mentions.onInputChange(val, e.target.selectionStart ?? val.length);
            }}
            onPaste={(e) => {
              const attached = attachImgFromPaste(e);
              if (attached) {
                e.preventDefault();
                toast.success("Image attached from clipboard", { duration: 1500 });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendOrQueue(draft.trim());
              }
            }}
            placeholder="Send a message to Statenour OS..."
            className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-2 py-2.5 text-[16px] text-zinc-200 outline-none placeholder:text-zinc-500"
            rows={1}
          />
        </div>

        {/* Right Toolbar (Send Button) */}
        <button
          type="submit"
          aria-label="Send message"
          disabled={(!draft.trim() && !imgAttached) || chat.status === "streaming"}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-zinc-950 transition-all duration-300 disabled:opacity-50 active:scale-95",
            (!draft.trim() && !imgAttached) || chat.status === "streaming"
              ? "bg-zinc-100"
              : "bg-gradient-to-br from-white to-zinc-300 shadow-[0_0_20px_-5px_rgba(255,255,255,0.4)] hover:shadow-[0_0_25px_-2px_rgba(255,255,255,0.5)] hover:scale-105"
          )}
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
