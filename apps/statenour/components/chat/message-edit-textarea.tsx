"use client";

/**
 * MessageEditTextarea — inline edit affordance shown when the
 * operator taps a USER message to revise + resend it.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~62 LOC of
 * inline JSX with Enter-to-resend + Escape-to-cancel handlers. The
 * parent owns the source `messages` array + the truncate-then-resend
 * orchestration · this component just owns the editor surface and
 * delegates via callbacks.
 */
export function MessageEditTextarea({
  value,
  onChange,
  onResend,
  onCancel,
}: {
  value: string;
  onChange: (next: string) => void;
  onResend: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-1">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (value.trim()) {
              onResend();
            }
            return;
          }
          if (e.key === "Escape") {
            onCancel();
          }
        }}
        className="w-full bg-transparent text-[13.5px] leading-[1.6] text-[var(--text-primary)] resize-none outline-none border-b border-[var(--gold)]/40"
        rows={2}
      />
      <div className="flex items-center gap-1 text-[8px]">
        <button
          onClick={() => {
            if (!value.trim()) return;
            onResend();
          }}
          className="px-2 py-0.5 rounded bg-[var(--gold)]/15 text-[var(--gold)] hover:bg-[var(--gold)]/25"
        >
          Resend
        </button>
        <button
          onClick={onCancel}
          className="px-2 py-0.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
