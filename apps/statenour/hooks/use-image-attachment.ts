/**
 * Image attachment state for chat input.
 *
 * Manages: the attached file + preview URL, two hidden <input type="file">
 * elements (gallery + camera), and serialization to base64 for sending.
 *
 * Returns refs to attach to the hidden inputs, plus a clear handler and
 * a sendAsBase64 helper.
 */

"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { decideAttachment } from "@/lib/media/attachment-policy";

export interface AttachedImage {
  file: File;
  preview: string;
}

export function useImageAttachment() {
  const [attached, setAttached] = useState<AttachedImage | null>(null);
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
   *
   * It previously rejected every non-image with "Images only for now —
   * PDFs and docs aren't readable yet." That message outlived its
   * constraint: BDN-309 taught the renderer to display audio and PDFs,
   * so the app could SHOW media it refused to let the operator ATTACH.
   * Video is still refused, but now for the real reason (base64 inlining
   * with no upload lane) rather than by blanket type.
   */
  const acceptFile = useCallback((file: File): boolean => {
    const decision = decideAttachment({ name: file.name, type: file.type, size: file.size });
    if (!decision.accepted) {
      toast.error(decision.reason, { duration: 4000 });
      return false;
    }
    // Replacing an existing pick · revoke the old object URL first
    // (pre-fix each replacement leaked the previous blob).
    setAttached((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return { file, preview: URL.createObjectURL(file) };
    });
    return true;
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) acceptFile(file);
      e.target.value = "";
    },
    [acceptFile],
  );

  /**
   * Drag-and-drop. The `accept` attribute does not apply to drops, so
   * the policy gate is the only thing standing between a dropped 2 GB
   * file and a base64 encode — same reasoning as the 2026-07-16 note
   * above about paste.
   */
  const attachFromDrop = useCallback(
    (e: React.DragEvent<HTMLElement>): boolean => {
      const file = e.dataTransfer?.files?.[0];
      if (!file) return false;
      return acceptFile(file);
    },
    [acceptFile],
  );

  const clear = useCallback(() => {
    setAttached((prev) => {
      if (prev?.preview) URL.revokeObjectURL(prev.preview);
      return null;
    });
  }, []);

  const openGallery = useCallback(() => fileInputRef.current?.click(), []);
  const openCamera = useCallback(() => cameraInputRef.current?.click(), []);

  /**
   * v10.0.515 · #2 Multimodal · clipboard-paste support.
   *
   * Accepts a paste event (or any DataTransfer/ClipboardEvent
   * source) and attaches the first image item it finds. Returns
   * true when an image was attached, false otherwise — the caller
   * can use the return value to decide whether to call
   * preventDefault on the paste event.
   *
   * Operator's common case: screenshot → Cmd+Shift+4 → switch to
   * chat → paste → Nick sees the screenshot.
   */
  const attachFromPaste = useCallback(
    (e: ClipboardEvent | React.ClipboardEvent<HTMLElement>): boolean => {
      const dt =
        "clipboardData" in e
          ? (e as React.ClipboardEvent).clipboardData
          : (e as ClipboardEvent).clipboardData;
      if (!dt) return false;

      const items = Array.from(dt.items ?? []);
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (!file) continue;
          // Some browsers give pasted images generic names like
          // "image.png" — keep them but tag with a timestamp so
          // the upload list has uniqueness when multiple pastes
          // happen in quick succession.
          const named =
            file.name && file.name !== "image.png"
              ? file
              : new File(
                  [file],
                  `paste-${Date.now()}.${(item.type.split("/")[1] || "png").replace(/\W/g, "")}`,
                  { type: file.type },
                );
          // BDN-314 · paste runs the SAME policy gate as picker and drop.
          // Before this, paste bypassed every check — the clipboard was
          // the one intake path with no type or size guard at all, and
          // widening it to non-images without this would have made that
          // hole strictly worse.
          if (!acceptFile(named)) return false;
          return true;
        }
      }
      return false;
    },
    [acceptFile],
  );

  /**
   * Read the attached file as base64. Resolves with { base64, mimeType }
   * or null if nothing attached / read failed.
   */
  const readAsBase64 = useCallback((): Promise<{ base64: string; mimeType: string } | null> => {
    return new Promise((resolve) => {
      if (!attached) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(",")[1];
        resolve({ base64, mimeType: attached.file.type });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(attached.file);
    });
  }, [attached]);

  return {
    attached,
    fileInputRef,
    cameraInputRef,
    handleFileChange,
    clear,
    openGallery,
    openCamera,
    readAsBase64,
    attachFromPaste,
    attachFromDrop,
  };
}
