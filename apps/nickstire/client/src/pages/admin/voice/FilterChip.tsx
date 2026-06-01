export function FilterChip({
  label, count, active, onClick, tone = "neutral",
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tone?: string;
}) {
  // Tone => active background tint per end-reason
  const tones: Record<string, string> = {
    "customer-ended-call":     "bg-blue-500/15 border-blue-500/40 text-blue-400",
    "assistant-ended-call":    "bg-emerald-500/15 border-emerald-500/40 text-emerald-400",
    "assistant-forwarded-call":"bg-amber-500/15 border-amber-500/40 text-amber-400",
    neutral:                   "bg-primary/15 border-primary/40 text-primary",
  };
  const activeClass = tones[tone] || tones.neutral;
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] " +
        "border transition-colors " +
        (active
          ? activeClass
          : "border-border/30 text-foreground/55 hover:border-foreground/30 hover:text-foreground/80")
      }
    >
      <span>{label}</span>
      <span className={"text-[10px] tabular-nums " + (active ? "" : "text-foreground/40")}>
        {count}
      </span>
    </button>
  );
}
