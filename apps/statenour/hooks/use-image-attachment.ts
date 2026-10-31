/**
 * Attachment state for chat input.
 *
 * Manages: the attached files + preview URLs, two hidden <input type="file">
 * elements (gallery + camera), and preparation for sending.
 *
 * U5 (2026-10-30, Nour: multi-select from the camera roll) · up to MAX_ATTACHMENTS per message,
 * picked together (input `multiple`) or one at a time; each one removable before send; photos
 * shrunk before upload (lib/media/compress-image.ts) with a "Preparing photo N of M" count.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { decideAttachment } from "@/lib/media/attachment-policy";
import { prepareForSend, type PreparedFile } from "@/lib/media/compress-image";
import { MAX_FILES_PER_MESSAGE, MAX_INLINE_CHARS } from "@/lib/ai/chat/attachment-cap";

/** Per message. The chat gate enforces the same number server-side (lib/ai/chat/attachment-cap.ts). */
export const MAX_ATTACHMENTS = MAX_FILES_PER_MESSAGE;

export interface AttachedImage {
  file: File;
  preview: string;
}

export function useImageAttachment({
  onAudio,
}: {
  /** 04-X1: an accepted audio file goes here instead of being attached. */
  onAudio?: (file: File) => void;
} = {}) {
  const [list, setList] = useState<AttachedImage[]>([]);
  const [preparing, setPreparing] = useState<{ done: number; total: number; photos: boolean } | null>(null);
  // Read outside state updaters: a toast inside one fires twice under StrictMode.
  const listRef = useRef(list);
  useEffect(() => {
    listRef.current = list;
  }, [list]);
  useEffect(() => () => {
    for (const a of listRef.current) URL.revokeObjectURL(a.preview);
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Truthfulness wave (audit 2026-07-16) · intake guards. Pre-fix this
  // accepted ANY file at ANY size with no type check: the whole file was
  // read into memory and base64'd on send, so a 500 MB pick was a browser
  // hang and a doomed multi-hundred-MB request body. The accept attribute
  // is a hint the OS picker can bypass (and paste/drag ignore it), so the
  // guard has to live here.
  /**
   * BDN-314 · the type/size gate now lives in
   * lib/media/attachment-policy.ts, shared by picker, paste AND drop.
   */
  /** Attaches every acceptable file up to the cap; true when at least one was attached. */
  const acceptFiles = useCallback((files: File[]): boolean => {
    const accepted: File[] = [];
    let audioTaken = false;
    for (const file of files) {
      const decision = decideAttachment({ name: file.name, type: file.type, size: file.size });
      if (!decision.accepted) {
        toast.error(decision.reason, { duration: 4000 });
        continue;
      }
      // 04-X1: inline audio bytes reach the model as nothing it can hear, so
      // audio is handed to transcription and never attached.
      if (decision.kind === "audio" && onAudio) {
        // One per pick: parallel transcriptions shared one progress flag and landed out of order.
        if (audioTaken) {
          toast(`Transcribing one audio file at a time. Skipped ${file.name}.`, { duration: 4000 });
          continue;
        }
        audioTaken = true;
        onAudio(file);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return false;
    const roomNow = MAX_ATTACHMENTS - listRef.current.length;
    if (accepted.length > roomNow) {
      toast(`${MAX_ATTACHMENTS} files per message. Kept the first ${Math.max(roomNow, 0)}.`, { id: "attach-cap", duration: 4000 });
    }
    setList((prev) => {
      const room = MAX_ATTACHMENTS - prev.length;
      const added = accepted.slice(0, Math.max(room, 0)).map((file) => ({ file, preview: URL.createObjectURL(file) }));
      return [...prev, ...added];
    });
    return true;
  }, [onAudio]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      if (files.length) acceptFiles(files);
      e.target.value = "";
    },
    [acceptFiles],
  );

  /**
   * Drag-and-drop. The `accept` attribute does not apply to drops, so
   * the policy gate is the only thing standing between a dropped 2 GB
   * file and a base64 encode.
   */
  const attachFromDrop = useCallback(
    (e: React.DragEvent<HTMLElement>): boolean => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      return files.length ? acceptFiles(files) : false;
    },
    [acceptFiles],
  );

  const remove = useCallback((index: number) => {
    setList((prev) => {
      const gone = prev[index];
      if (gone) URL.revokeObjectURL(gone.preview);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const clear = useCallback(() => {
    setList((prev) => {
      for (const a of prev) URL.revokeObjectURL(a.preview);
      return [];
    });
  }, []);

  /** Removes exactly these items: one added while a send was preparing stays for the next message. */
  const discard = useCallback((items: readonly AttachedImage[]) => {
    const gone = new Set(items);
    setList((prev) => {
      for (const a of prev) if (gone.has(a)) URL.revokeObjectURL(a.preview);
      return prev.filter((a) => !gone.has(a));
    });
  }, []);

  const openGallery = useCallback(() => fileInputRef.current?.click(), []);
  const openCamera = useCallback(() => cameraInputRef.current?.click(), []);

  /**
   * v10.0.515 · #2 Multimodal · clipboard-paste support. Attaches every file
   * item on the clipboard (same policy gate as picker and drop).
   */
  const attachFromPaste = useCallback(
    (e: ClipboardEvent | React.ClipboardEvent<HTMLElement>): boolean => {
      const dt =
        "clipboardData" in e
          ? (e as React.ClipboardEvent).clipboardData
          : (e as ClipboardEvent).clipboardData;
      if (!dt) return false;
      const files: File[] = [];
      for (const item of Array.from(dt.items ?? [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        // Some browsers give pasted images generic names like "image.png";
        // tag with a timestamp so several pastes stay distinct.
        files.push(
          file.name && file.name !== "image.png"
            ? file
            : new File([file], `paste-${Date.now()}-${files.length}.${(item.type.split("/")[1] || "png").replace(/\W/g, "")}`, { type: file.type }),
        );
      }
      return files.length ? acceptFiles(files) : false;
    },
    [acceptFiles],
  );

  /**
   * Every attachment ready for a `file` message part, photos shrunk first. Resolves to [] when
   * nothing is attached. A file that cannot be read is skipped and named in a toast.
   */
  const prepareAll = useCallback(async (): Promise<PreparedFile[]> => {
    if (list.length === 0) return [];
    const out: PreparedFile[] = [];
    let chars = 0;
    const photos = list.every((a) => a.file.type.startsWith("image/"));
    setPreparing({ done: 0, total: list.length, photos });
    try {
      for (const [i, a] of list.entries()) {
        try {
          const p = await prepareForSend(a.file);
          out.push(p);
          // Past the cap the message cannot go; stop encoding (ten big PDFs would hold 100+ MB of
          // base64 in an iPhone tab). The caller's cap check refuses what came back.
          chars += p.base64.length;
          if (chars > MAX_INLINE_CHARS) break;
        } catch {
          toast.error(`Couldn't read ${a.file.name}.`, { duration: 4000 });
        }
        setPreparing({ done: i + 1, total: list.length, photos });
      }
    } finally {
      setPreparing(null);
    }
    return out;
  }, [list]);

  return {
    /** null when nothing is attached, so `if (attached)` keeps working for callers. */
    attached: list.length ? list : null,
    preparing,
    fileInputRef,
    cameraInputRef,
    handleFileChange,
    remove,
    clear,
    discard,
    openGallery,
    openCamera,
    prepareAll,
    attachFromPaste,
    attachFromDrop,
  };
}
