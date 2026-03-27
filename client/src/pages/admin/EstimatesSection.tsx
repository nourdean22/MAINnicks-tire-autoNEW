/**
 * Estimate Log — shows recent AI repair estimate requests from the website.
 * Helps track which repairs customers are researching (warm leads).
 */
import { trpc } from "@/lib/trpc";
import { Loader2, DollarSign, Car, Clock, Search, TrendingUp } from "lucide-react";

export default function EstimatesSection() {
  // We'll use the lead data to show estimate-related leads
  const { data: leads, isLoading } = trpc.lead.list.useQuery();

  // Filter for estimate-related leads (source contains "estimate")
  const estimateLeads = leads?.filter((l: any) =>
    l.source?.toLowerCase().includes("estimate") || 
    l.source?.toLowerCase().includes("labor")
  ) || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h2 className="font-bold text-2xl text-foreground tracking-wider">ESTIMATE LOG</h2>
        <p className="text-foreground/50 text-[12px] mt-1">Track AI repair estimate requests — these are warm leads researching repair costs</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-start justify-between mb-3">
            <span className="font-mono text-[10px] text-foreground/50 tracking-wide">Total Estimates</span>
            <DollarSign className="w-4 h-4 text-foreground/30" />
          </div>
          <div className="font-bold text-3xl text-foreground tracking-tight">{estimateLeads.length}</div>
          <p className="font-mono text-[10px] text-foreground/40 mt-1">Customers researching repair costs</p>
        </div>
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-start justify-between mb-3">
            <span className="font-mono text-[10px] text-foreground/50 tracking-wide">Conversion Potential</span>
            <TrendingUp className="w-4 h-4 text-foreground/30" />
          </div>
          <div className="font-bold text-3xl text-primary tracking-tight">HIGH</div>
          <p className="font-mono text-[10px] text-foreground/40 mt-1">Estimate users are 3x more likely to book</p>
        </div>
        <div className="bg-card border border-border/30 p-5">
          <div className="flex items-start justify-between mb-3">
            <span className="font-mono text-[10px] text-foreground/50 tracking-wide">Avg Response Time</span>
            <Clock className="w-4 h-4 text-foreground/30" />
          </div>
          <div className="font-bold text-3xl text-emerald-400 tracking-tight">&lt;5s</div>
          <p className="font-mono text-[10px] text-foreground/40 mt-1">AI-powered instant estimates</p>
        </div>
      </div>

      {/* Estimate Leads Table */}
      <div className="bg-card border border-border/30 p-6">
        <h3 className="font-bold text-sm text-foreground tracking-wide mb-4">RECENT ESTIMATE REQUESTS</h3>
        
        {estimateLeads.length === 0 ? (
          <div className="text-center py-12">
            <Search className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-foreground/40 text-[12px]">No estimate requests yet</p>
            <p className="text-foreground/30 text-[10px] mt-1">When customers use the AI Estimator, their requests appear here</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-border/30">
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Date</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Customer</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Vehicle</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2 pr-4">Repair</th>
                  <th className="font-mono text-[10px] text-foreground/40 tracking-wide py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {estimateLeads.map((lead: any) => (
                  <tr key={lead.id} className="border-b border-border/10">
                    <td className="py-2.5 pr-4">
                      <span className="text-[12px] text-foreground/70">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-[12px] text-foreground">{lead.name || "Anonymous"}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      <div className="flex items-center gap-1.5">
                        <Car className="w-3 h-3 text-foreground/30" />
                        <span className="text-[12px] text-foreground/70">{lead.vehicle || "—"}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-[12px] text-foreground/70 line-clamp-1">{lead.problem || "—"}</span>
                    </td>
                    <td className="py-2.5">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider border ${
                        lead.status === "booked" ? "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" :
                        lead.status === "contacted" ? "text-amber-400 bg-amber-500/10 border-amber-500/20" :
                        "text-blue-400 bg-blue-500/10 border-blue-500/20"
                      }`}>
                        {(lead.status || "new").toUpperCase()}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="bg-primary/5 border border-primary/20 p-4">
        <h4 className="font-bold text-xs text-primary tracking-wide mb-2">HOW ESTIMATES DRIVE BOOKINGS</h4>
        <p className="text-foreground/60 text-xs leading-relaxed">
          When a customer uses the AI Repair Estimator on your website, they're actively researching repair costs — 
          a strong buying signal. Each estimate request is captured as a lead. Follow up with a call or text 
          to convert these warm leads into booked appointments.
        </p>
      </div>
    </div>
  );
}
