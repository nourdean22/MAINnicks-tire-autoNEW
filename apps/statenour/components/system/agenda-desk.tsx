"use client";

import { Panel } from "@/components/panel";
import { trpc } from "@/lib/trpc/client";

function timeAgo(date: Date | string | null): string {
  if (!date) return "never";
  const diff = Date.now() - new Date(date).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

interface AgendaDeskProps {
  queryResult: any;
}

export function AgendaDesk({ queryResult }: AgendaDeskProps) {
  const { data: items, isLoading } = queryResult;

  return (
    <Panel className="border-edge-default p-5 flex flex-col gap-4 md:col-span-2 lg:col-span-1 ">
              <div className="flex items-center justify-between border-b border-edge-subtle pb-3">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">A1 · Agenda Desk</span>
          <h3 className="text-sm font-semibold text-fg mt-0.5">Active Commitments & Intentions</h3>
        </div>
        {items && (
          <span className="rounded-full bg-content border border-edge-subtle px-2 py-0.5 text-[11px] font-mono text-fg-secondary">
            {items.length} items
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-2 py-4">
              <div className="h-4 bg-content rounded-micro animate-pulse w-3/4" />
          <div className="h-4 bg-content rounded-micro animate-pulse w-1/2" />
        </div>
      ) : items ? (
        <div className="flex-1 overflow-auto max-h-[220px] pr-1 space-y-2">
          {items.length === 0 ? (
            <div className="text-fg-tertiary text-xs text-center py-6">No active agenda items.</div>
          ) : (
            <div className="divide-y divide-edge-subtle space-y-2">
              {items.map((item: any) => {
                const categoryColor =
                  item.category === "WITNESSED_COMMITMENT"
                    ? "text-emerald-400 border-emerald-500/20 bg-emerald-500/5"
                    : item.category === "STANDING_INTENTION"
                      ? "text-purple-400 border-purple-500/20 bg-purple-500/5"
                      : item.category === "CONTRADICTION"
                        ? "text-red-400 border-red-500/20 bg-red-500/5"
                        : "text-amber-400 border-amber-500/20 bg-amber-500/5";

                return (
                  <div key={item.id} className="flex gap-2.5 pt-2 first:pt-0">
                    <div className="flex-1 space-y-0.5">
                      <div className="flex items-center justify-between gap-2">
              <span className={`text-[11px] font-mono border px-1.5 py-0.25 rounded-micro ${categoryColor}`}>
                          {item.category.replace("_", " ")}
                        </span>
                        <span className="text-[11px] text-fg-tertiary font-mono">
                          {timeAgo(item.createdAt)}
                        </span>
                      </div>
                      <h4 className="text-fg text-xs font-medium leading-snug mt-1">
                        {item.title}
                      </h4>
                      {item.description && (
                        <p className="text-fg-secondary text-[11px] leading-relaxed">
                          {item.description}
                        </p>
                      )}
                      {item.dueDate && (
                        <div className="text-[11px] text-fg-tertiary font-mono mt-0.5">
                          Due: {new Date(item.dueDate).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="text-fg-tertiary text-xs py-4">No agenda items available.</div>
      )}
    </Panel>
  );
}
