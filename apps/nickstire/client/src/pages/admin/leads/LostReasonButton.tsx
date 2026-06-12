import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { XCircle } from "lucide-react";

const LOST_REASONS = [
  "Price too high", "Went to competitor", "No response",
  "Changed mind", "Already fixed elsewhere", "Other",
] as const;

export function LostReasonButton({ leadId }: { leadId: number }) {
  const utils = trpc.useUtils();
  const [expanded, setExpanded] = useState(false);

  const mutation = trpc.lead.update.useMutation({
    onSuccess: () => {
      void utils.lead.list.invalidate();
      toast.success("Lead marked lost");
      setExpanded(false);
    },
    onError: (err) => toast.error("Failed: " + err.message),
  });

  if (expanded) {
    return (
      <div className="flex flex-col gap-1.5 border border-red-500/30 bg-red-500/5 p-2" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-[10px] tracking-wider text-red-400/80 font-bold">WHY LOST?</span>
          <button
            onClick={() => setExpanded(false)}
            className="px-1 text-foreground/40 hover:text-foreground/70 text-[12px] leading-none"
            aria-label="Cancel"
          >
            ×
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {LOST_REASONS.map((reason) => (
            <button
              key={reason}
              onClick={() => mutation.mutate({ id: leadId, status: "lost", lostReason: reason })}
              disabled={mutation.isPending}
              className="px-2 py-1 bg-card border border-red-500/20 text-red-400/80 text-[10px] tracking-wide hover:bg-red-500/15 hover:text-red-400 disabled:opacity-50 transition-colors"
            >
              {reason}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <button
      onClick={() => setExpanded(true)}
      disabled={mutation.isPending}
      className="flex items-center gap-2 border border-red-500/30 text-red-400 px-4 py-2.5 font-bold text-xs tracking-wide hover:bg-red-500/10 disabled:opacity-50"
    >
      <XCircle className="w-4 h-4" /> LOST
    </button>
  );
}
