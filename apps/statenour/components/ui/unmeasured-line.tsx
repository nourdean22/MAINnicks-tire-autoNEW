/**
 * UnmeasuredLine — the one way a read-that-renders says "the read failed".
 *
 * Truth discipline (2026-09-01, generalised 2026-10-02): a FAILED read must
 * never render like a measured quiet. A card stays silent on genuine
 * emptiness and names itself unmeasured when its query errors. Shared by the
 * /system/health data cards and the /brain memory-of-the-day card so the
 * sentence is identical wherever it appears.
 */
export function UnmeasuredLine({ label }: { label: string }) {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
      {label}: unmeasured — the read failed (not zero).
    </p>
  );
}
