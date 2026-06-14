import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, UserCheck } from "lucide-react";

export function MarkContactedButton({ leadId, variant }: { leadId: number; variant: "banner" | "list" }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);
  const [notes, setNotes] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mutation = trpc.lead.update.useMutation({
    onSuccess: () => {
      void utils.lead.list.invalidate();
      toast.success("Lead marked contacted");
      setExpanded(false);
      setNotes("");
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const submit = () => {
    const trimmed = notes.trim();
    mutation.mutate({
      id: leadId,
      status: "contacted",
      contacted: 1,
      contactNotes: trimmed.length > 0 ? trimmed : undefined,
    });
  };

  if (expanded) {
    return (
      <div className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") { setExpanded(false); setNotes(""); }
          }}
          placeholder="Notes (optional)"
          aria-label="Contact notes"
          className="px-2 py-1 bg-card border border-primary/30 text-foreground text-[11px] tracking-wide placeholder:text-foreground/30 focus:outline-none focus:border-primary w-40"
        />
        <button
          onClick={submit}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[11px] font-bold tracking-wide hover:bg-emerald-500/25 disabled:opacity-50"
          aria-label="Save contacted"
        >
          {mutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserCheck className="w-3 h-3" />}
          SAVE
        </button>
        <button
          onClick={() => { setExpanded(false); setNotes(""); }}
          className="px-2 py-1 text-foreground/40 hover:text-foreground/70 text-[12px] leading-none"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
    );
  }

  if (variant === "banner") {
    return (
      <button
        onClick={() => setExpanded(true)}
        disabled={mutation.isPending}
        className="px-2 py-1 bg-emerald-500/20 text-emerald-400 text-[10px] font-bold rounded hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
      >
        Mark Called
      </button>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      disabled={mutation.isPending}
      className="flex items-center gap-2 border border-primary/30 text-primary px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-primary/10 disabled:opacity-50"
    >
      <UserCheck className="w-4 h-4" /> MARK CONTACTED
    </button>
  );
}
