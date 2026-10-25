import { useState, useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, UserCheck } from "lucide-react";

export function MarkContactedButton({ leadId }: { leadId: number }) {
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
      <div className="inline-flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
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
          className="min-h-[48px] px-2 bg-card border border-primary/30 text-foreground text-base placeholder:text-foreground/60 focus:outline-none focus:border-primary w-48"
        />
        <button
          onClick={submit}
          disabled={mutation.isPending}
          className="inline-flex items-center gap-1 min-h-[48px] px-3 bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-sm font-bold hover:bg-emerald-500/25 disabled:opacity-50"
          aria-label="Save contacted"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserCheck className="w-4 h-4" />}
          Save
        </button>
        <button
          onClick={() => { setExpanded(false); setNotes(""); }}
          className="min-h-[48px] min-w-[48px] text-foreground/60 hover:text-foreground/80 text-base"
          aria-label="Cancel"
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      disabled={mutation.isPending}
      className="flex items-center gap-2 min-h-[48px] border border-primary/30 text-primary px-4 font-bold text-xs tracking-wide hover:bg-primary/10 disabled:opacity-50"
    >
      <UserCheck className="w-4 h-4" /> MARK CONTACTED
    </button>
  );
}
