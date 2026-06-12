import React from "react";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import {
  Zap, Phone, MessageSquare, ChevronRight,
  Users, FileText, PhoneCall, Star
} from "lucide-react";
import MessageCustomerLink from "@/components/admin/MessageCustomerLink";
import type { NBAAction } from "./types";

const NBA_TYPE_CONFIG: Record<string, { icon: React.ReactNode; color: string; bgColor: string; label: string }> = {
  hot_lead: { icon: <Users className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10", label: "LEAD" },
  pending_invoice: { icon: <FileText className="w-3.5 h-3.5" />, color: "text-emerald-400", bgColor: "bg-emerald-500/10", label: "INVOICE" },
  callback: { icon: <PhoneCall className="w-3.5 h-3.5" />, color: "text-blue-400", bgColor: "bg-blue-500/10", label: "CALLBACK" },
  vip_winback: { icon: <Star className="w-3.5 h-3.5" />, color: "text-amber-400", bgColor: "bg-amber-500/10", label: "VIP" },
};

const URGENCY_DOTS: Record<number, string> = {
  5: "bg-red-500",
  4: "bg-amber-500",
  3: "bg-amber-400",
  2: "bg-foreground/40",
  1: "bg-foreground/30",
};

export function NextBestActions() {
  const { data, isLoading } = trpc.intelligence.nextBestActions.useQuery(undefined, {
    refetchInterval: 30000,
    staleTime: 25_000, // wave-171: prevent stale=true on every refetch tick
  });

  if (isLoading) return null;
  if (!data?.actions?.length) return null;

  return (
    <div className="bg-card border-2 border-red-500/30 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-1.5 rounded bg-red-500/15">
          <Zap className="w-4 h-4 text-red-400" />
        </div>
        <h3 className="text-xs font-black tracking-widest text-red-400 uppercase">
          What To Do Now
        </h3>
        <span className="ml-1 text-[10px] bg-red-500/15 text-red-400 px-2 py-0.5 rounded-full font-bold">
          {data.actions.length}
        </span>
      </div>

      <div className="space-y-1.5">
        {data.actions.map((action: NBAAction, i: number) => {
          const cfg = NBA_TYPE_CONFIG[action.type] || NBA_TYPE_CONFIG.hot_lead;
          return (
            <div
              key={`${action.type}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 bg-background/50 border border-border/20 hover:border-primary/30 transition-all group"
            >
              {/* Urgency dot */}
              <span className={`w-2 h-2 rounded-full shrink-0 ${URGENCY_DOTS[action.urgency] || URGENCY_DOTS[1]} ${action.urgency >= 4 ? "animate-pulse" : ""}`} />

              {/* Type icon */}
              <div className={`shrink-0 ${cfg.color}`}>{cfg.icon}</div>

              {/* Message */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-foreground truncate">{action.message}</span>
                  <span className={`text-[9px] font-bold tracking-wider px-1.5 py-0.5 rounded shrink-0 ${cfg.color} ${cfg.bgColor}`}>
                    {cfg.label}
                  </span>
                </div>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-1 shrink-0 opacity-100 sm:opacity-60 sm:group-hover:opacity-100 transition-opacity">
                {action.phone && (
                  <a
                    href={`tel:${action.phone}`}
                    className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded transition-all"
                    title="Call"
                    aria-label="Call customer"
                  >
                    <Phone className="w-3.5 h-3.5" />
                  </a>
                )}
                {action.phone && (
                  <MessageCustomerLink
                    phone={action.phone}
                    className="p-1.5 text-blue-400 hover:bg-blue-500/10 rounded transition-all"
                    title="Open in-admin SMS chat"
                    ariaLabel="Send text message via in-admin SMS chat"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </MessageCustomerLink>
                )}
                <Link
                  href={action.actionUrl}
                  className="p-1.5 text-foreground/30 hover:text-primary hover:bg-primary/10 rounded transition-all"
                  title="View"
                  aria-label="View details"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
