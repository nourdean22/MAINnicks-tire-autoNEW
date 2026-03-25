/**
 * AutoFollowUpSection — Monitors the automated 7-day post-invoice follow-up system.
 * Shows stats, recent sends, and configuration status.
 */
import { trpc } from "@/lib/trpc";
import { StatCard } from "./shared";
import {
  Timer, Send, CheckCircle2, XCircle, Clock, Users,
  Loader2, MessageSquare, RefreshCw, AlertTriangle
} from "lucide-react";

export default function AutoFollowUpSection() {
  const { data: customerStats } = trpc.customers.stats.useQuery();
  const { data: campaignStats } = trpc.customers.campaignStats.useQuery(undefined, {
    refetchInterval: 15000, // refresh every 15s while campaign is running
  });
  const { data: recentFollowUps } = trpc.customers.recentFollowUps.useQuery(undefined, {
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-8">
      {/* System Status */}
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-emerald-500/10 flex items-center justify-center">
            <Timer className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-foreground tracking-wider">AUTOMATED FOLLOW-UP SYSTEM</h3>
            <p className="text-foreground/40 text-xs tracking-wider">7-DAY POST-INVOICE — RUNS EVERY HOUR</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="font-mono text-[10px] text-emerald-400 tracking-wider">ACTIVE</span>
          </div>
        </div>
        <p className="text-foreground/60 text-sm leading-relaxed">
          Automatically sends a thank you + Google review request + referral link to every customer 7 days after their last visit. 
          Prevents duplicates by tracking which customers have already been texted.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total Customers"
          value={customerStats?.total ?? 0}
          icon={<Users className="w-4 h-4" />}
        />
        <StatCard
          label="Texted (Campaign)"
          value={campaignStats?.sent ?? 0}
          icon={<Send className="w-4 h-4" />}
          color="text-emerald-400"
        />
        <StatCard
          label="Not Yet Texted"
          value={campaignStats?.remaining ?? 0}
          icon={<Clock className="w-4 h-4" />}
          color="text-amber-400"
        />
        <StatCard
          label="Eligible (7-Day Window)"
          value={campaignStats?.eligible ?? 0}
          icon={<Timer className="w-4 h-4" />}
          color="text-blue-400"
        />
      </div>

      {/* Campaign Progress Bar */}
      {campaignStats && campaignStats.total > 0 && (
        <div className="bg-card border border-border/30 p-6">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-bold text-sm text-foreground tracking-wider">SMS CAMPAIGN PROGRESS</h4>
            <span className="font-mono text-[10px] text-foreground/40 tracking-wider">
              {campaignStats.sent} / {campaignStats.total} SENT ({Math.round((campaignStats.sent / campaignStats.total) * 100)}%)
            </span>
          </div>
          <div className="w-full bg-foreground/5 h-3">
            <div
              className="bg-primary h-3 transition-all duration-500"
              style={{ width: `${Math.round((campaignStats.sent / campaignStats.total) * 100)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-3 text-foreground/40">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-[10px] tracking-wider">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" /> {campaignStats.sent} Sent
              </span>
              <span className="flex items-center gap-1.5 text-[10px] tracking-wider">
                <Clock className="w-3 h-3 text-amber-400" /> {campaignStats.remaining} Remaining
              </span>
            </div>
            {campaignStats.remaining > 0 && (
              <span className="font-mono text-[10px] text-foreground/30 tracking-wider">
                ~{Math.ceil(campaignStats.remaining / 60)} min remaining at 1/sec
              </span>
            )}
          </div>
        </div>
      )}

      {/* How It Works */}
      <div className="bg-card border border-border/30 p-6">
        <h4 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">HOW IT WORKS</h4>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-[12px] text-primary font-bold">1</span>
            </div>
            <div>
              <span className="font-bold text-xs text-foreground tracking-wider block">CUSTOMER VISITS</span>
              <p className="text-foreground/50 text-xs mt-1 leading-relaxed">
                Customer gets an invoice at Nick's. Their visit date is recorded in the database.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-[12px] text-primary font-bold">2</span>
            </div>
            <div>
              <span className="font-bold text-xs text-foreground tracking-wider block">7 DAYS LATER</span>
              <p className="text-foreground/50 text-xs mt-1 leading-relaxed">
                System checks hourly for customers whose last visit was 7 days ago (±1 day window).
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-[12px] text-primary font-bold">3</span>
            </div>
            <div>
              <span className="font-bold text-xs text-foreground tracking-wider block">AUTO-TEXT SENT</span>
              <p className="text-foreground/50 text-xs mt-1 leading-relaxed">
                Thank you + Google review link + referral link. Max 20 per run to stay within rate limits.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Follow-Ups */}
      <div>
        <h4 className="font-bold text-sm text-foreground/60 tracking-wide mb-3">RECENT AUTOMATED SENDS</h4>
        {!recentFollowUps || recentFollowUps.length === 0 ? (
          <div className="bg-card border border-border/30 p-8 text-center">
            <MessageSquare className="w-8 h-8 text-foreground/20 mx-auto mb-3" />
            <p className="text-foreground/40 text-sm">No automated follow-ups sent yet. The system will start sending once customers' visits are 7 days old.</p>
          </div>
        ) : (
          <div className="bg-card border border-border/30 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/20">
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Customer</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Phone</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide">Segment</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden sm:table-cell">Last Visit</th>
                  <th className="text-left p-3 text-[10px] text-foreground/40 tracking-wide hidden md:table-cell">Texted</th>
                </tr>
              </thead>
              <tbody>
                {recentFollowUps.map((c: any) => (
                  <tr key={c.id} className="border-b border-border/10">
                    <td className="p-3 text-foreground">{c.firstName} {c.lastName || ""}</td>
                    <td className="p-3 text-[12px] text-foreground/60">{c.phone}</td>
                    <td className="p-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] tracking-wider ${
                        c.segment === "recent" ? "text-emerald-400 bg-emerald-500/10"
                          : c.segment === "lapsed" ? "text-amber-400 bg-amber-500/10"
                          : "text-foreground/50 bg-foreground/5"
                      }`}>
                        {c.segment.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-3 text-[10px] text-foreground/40 hidden sm:table-cell">
                      {c.lastVisitDate ? new Date(c.lastVisitDate).toLocaleDateString() : "—"}
                    </td>
                    <td className="p-3 text-[10px] text-foreground/40 hidden md:table-cell">
                      {c.smsCampaignDate ? new Date(c.smsCampaignDate).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Message Template Preview */}
      <div className="bg-card border border-border/30 p-6">
        <h4 className="font-bold text-sm text-foreground tracking-[-0.01em] mb-4">MESSAGE TEMPLATE</h4>
        <div className="bg-background border border-border/20 p-4 text-[12px] text-foreground/70 leading-relaxed whitespace-pre-wrap">
{`Hi [First Name], thank you for choosing Nick's Tire & Auto! We truly appreciate your business.

If you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:
[Google Review Link]

Know someone who needs reliable auto service? Refer them to us: autonicks.com/refer

Thank you! — Nick's Team
(216) 862-0005`}
        </div>
      </div>
    </div>
  );
}
