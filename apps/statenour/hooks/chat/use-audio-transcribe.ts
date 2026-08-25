"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

/**
 * useAudioTranscribe — file-picker handler that uploads an audio
 * blob to /api/ai/chat/audio-transcribe (whisper-1 since 2026-08-25). The
 * returned transcript is forwarded to the parent via `onTranscript`
 * so the composer can append it to the textarea (same UX as voice
 * input, but for files: voice memos, recorded calls, podcast clips).
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · this was
 * inline `handleAudioAttach` (~36 LOC of fetch + toast + transcript
 * relay) wired into the hidden <input type="file"> in the composer
 * toolbar. Lifting it into a hook keeps the page focused on
 * orchestration · the toolbar receives a stable `onAudioChange`
 * callback + the `transcribing` flag straight from the hook.
 */
export function useAudioTranscribe({
  onTranscript,
}: {
  /** Fired with the transcribed text once the upload succeeds. */
  onTranscript: (text: string) => void;
}): {
  transcribing: boolean;
  handleAudioAttach: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
} {
  const [transcribing, setTranscribing] = useState(false);

  const handleAudioAttach = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setTranscribing(true);
      const tid = toast.loading("Transcribing audio…", { description: file.name });
      try {
        const fd = new FormData();
        fd.append("file", file, file.name);
        const res = await fetch("/api/ai/chat/audio-transcribe", {
          method: "POST",
          body: fd,
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string; hint?: string };
          throw new Error(j.error ?? `HTTP ${res.status}` + (j.hint ? ` · ${j.hint}` : ""));
        }
        const { transcript } = (await res.json()) as { transcript?: string };
        if (transcript) {
          onTranscript(transcript);
          toast.success("Transcript added", { id: tid });
        } else {
          toast.error("Empty transcript", { id: tid });
        }
      } catch (err) {
        toast.error("Audio transcribe failed", {
          id: tid,
          description: (err as Error).message,
        });
      } finally {
        setTranscribing(false);
      }
    },
    [onTranscript],
  );

  return { transcribing, handleAudioAttach };
}
