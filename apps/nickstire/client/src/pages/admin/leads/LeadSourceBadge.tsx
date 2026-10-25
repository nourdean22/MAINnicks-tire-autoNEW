// Kept from KanbanBoard.tsx when the kanban was retired (2026-10-25): marks a lead that came by
// phone or as a callback, so the crew knows it may already sit under Call Tracking. Web leads get none.
import { PhoneCall } from "lucide-react";
import { classifyLeadOrigin, type LeadOriginInput } from "@shared/leadSource";

export function LeadSourceBadge({ lead }: { lead: LeadOriginInput }) {
  const origin = classifyLeadOrigin(lead);
  if (origin === "phoneCall") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] tracking-wider font-bold text-sky-400 bg-sky-500/10 border-sky-500/30">
        <PhoneCall className="w-3 h-3" /> PHONE
      </span>
    );
  }
  if (origin === "duplicateLink" || origin === "operationalCallback") {
    return (
      <span
        title={origin === "duplicateLink"
          ? "Callback request: same person also appears under Call Tracking"
          : "Callback request"}
        className="inline-flex items-center gap-1 px-2 py-0.5 border text-[10px] tracking-wider font-bold text-amber-400 bg-amber-500/10 border-amber-500/30"
      >
        <PhoneCall className="w-3 h-3" /> CALLBACK
      </span>
    );
  }
  return null;
}
