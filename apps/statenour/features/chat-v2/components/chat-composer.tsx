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

  // Auto-resize
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [draft]);

  // Intelligence Hooks
  const img = useImageAttachment();
  const slash = useSlashCommands();
  const mentions = useMentionSuggestions();

  const sendOrQueue = async (textToSend: string) => {
    if (!textToSend.trim() && !img.attached) return;

    const tempId = crypto.randomUUID();
    const isImageAttached = !!img.attached;

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
        const result = await img.readAsBase64();
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
            filename: img.attached!.file.name,
          });

          await chat.append({
            id: tempId,
            role: "user",
            content: textToSend, // Still provide string content for logging/fallbacks
            parts: parts,
          });
          img.clear();
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
    if (!draft.trim() && !img.attached) return;
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
              setTimeout(() => {
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
      {img.attached && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900 overflow-hidden mb-1">
          <AttachmentPreview
            file={img.attached.file}
            preview={img.attached.preview}
            onClear={img.clear}
          />
        </div>
      )}

      {/* Main Composer Chrome */}
      <div className="relative flex items-end gap-2 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 shadow-sm focus-within:border-zinc-700 focus-within:ring-1 focus-within:ring-zinc-700">
        
        {/* Left Toolbar (Minimalist) */}
        <div className="flex shrink-0 items-center gap-1 pb-1 pl-1">
          <button
            type="button"
            onClick={img.openGallery}
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
            aria-label="Attach image"
          >
            <ImageIcon size={18} />
          </button>
          
          <button
            type="button"
            onClick={voice.isRecording || voice.continuous ? voice.stopRecording : voice.startRecording}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl transition-colors",
              voice.isRecording || voice.continuous
                ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
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
          ref={img.fileInputRef}
          onChange={img.handleFileChange}
          className="hidden"
          accept="image/*,application/pdf,.doc,.docx,.txt"
        />
        <input
          type="file"
          ref={img.cameraInputRef}
          onChange={img.handleFileChange}
          className="hidden"
          accept="image/*"
          capture="environment"
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
              const attached = img.attachFromPaste(e);
              if (attached) {
                e.preventDefault();
                toast.success("Image attached from clipboard", { duration: 1500 });
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e as any);
              }
            }}
            placeholder="Send a message to Statenour OS..."
            className="max-h-[200px] min-h-[44px] w-full resize-none bg-transparent px-2 py-2.5 text-[15px] text-zinc-200 outline-none placeholder:text-zinc-500"
            rows={1}
          />
        </div>

        {/* Right Toolbar (Send Button) */}
        <button
          type="submit"
          aria-label="Send message"
          disabled={(!draft.trim() && !img.attached) || chat.status === "streaming"}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-950 transition-transform disabled:opacity-50 active:scale-95 hover:bg-white"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
             <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5m0 0l-7 7m7-7l7 7" />
          </svg>
        </button>
      </div>
    </form>
  );
}
