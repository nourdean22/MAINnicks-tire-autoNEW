"use client";

import { FileText, Music, Paperclip, X } from "lucide-react";

/**
 * AttachmentPreview — the thumbnail + filename strip that appears
 * above the composer when the operator attaches a file.
 *
 * BDN-314 · was image-thumbnail-or-paperclip, from when the composer
 * accepted images only. Intake now admits audio and PDFs, so an
 * undifferentiated paperclip would leave a voice memo and an invoice
 * looking identical at the exact moment the operator is checking they
 * picked the right file. Audio and PDF get their own glyph; genuinely
 * unknown types keep the paperclip.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~22 LOC of
 * inline JSX. The parent owns the attachment store via
 * useImageAttachment; this component just presents what's attached
 * and surfaces the clear callback.
 */
export function AttachmentPreview({
  file,
  preview,
  onClear,
}: {
  file: File;
  preview: string;
  onClear: () => void;
}) {
  const isImage = file.type.startsWith("image/");
  const isAudio = file.type.startsWith("audio/");
  const isPdf = file.type === "application/pdf";
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border-default)]">
      {isImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Attached"
          className="w-10 h-10 rounded object-cover border border-[var(--border-default)]"
        />
      ) : (
        <div className="w-10 h-10 rounded border border-[var(--border-default)] bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-tertiary)]">
          {isAudio ? <Music size={14} /> : isPdf ? <FileText size={14} /> : <Paperclip size={14} />}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-[var(--text-secondary)] truncate">{file.name}</div>
        <div className="text-[9px] text-[var(--text-tertiary)]">
          {file.type || "application/octet-stream"}
          {file.size ? ` · ${Math.round(file.size / 1024)} KB` : ""}
        </div>
      </div>
      <button
        onClick={onClear}
        className="text-[var(--text-tertiary)] hover:text-red-400 transition-colors"
        aria-label="Remove attachment"
        title="Remove attachment"
      >
        <X size={12} />
      </button>
    </div>
  );
}
