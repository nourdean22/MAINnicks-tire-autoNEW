"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, LayoutList, CheckCircle2, XCircle, Layers } from "lucide-react";
import { StandardPage } from "@/components/layout/standard-page";
import { OpportunityCard, Opportunity } from "@/components/intelligence/OpportunityCard";

type TabStatus = "pending" | "accepted" | "declined" | "all";

export default function DecisionLedgerPage() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabStatus>("pending");

  const fetchOpportunities = async (status: TabStatus) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/intelligence/opportunities?status=${status}`);
      const body = await res.json();
      // apiHandler wraps plain-object returns as { ok, data, meta } (lib/utils/http.ts:93, :278).
      // Reading `body.status` made this ALWAYS false, so the queue rendered empty regardless of
      // what the route returned. Same defect as intelligence/brief/page.tsx, fixed 2026-08-21.
      const payload = body?.data ?? body;
      setOpportunities(payload?.status === "success" ? (payload.opportunities ?? []) : []);
    } catch (err) {
      toast.error("Failed to load opportunities queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void fetchOpportunities(activeTab), 0);
    return () => clearTimeout(t);
  }, [activeTab]);

  const handleStatusChange = (id: string, newStatus: string) => {
    // If the tab is filtering for a specific status, remove the item from the list
    if (activeTab !== "all" && activeTab !== newStatus) {
      setOpportunities((prev) => prev.filter((opp) => opp.id !== id));
    } else {
      // Otherwise update it in place
      setOpportunities((prev) =>
        prev.map((opp) => (opp.id === id ? { ...opp, status: newStatus } : opp))
      );
    }
    toast.success(`Opportunity status updated to ${newStatus}`);
  };

  const tabs: { key: TabStatus; label: string; icon: React.ReactNode }[] = [
    {
      key: "pending",
      label: "Pending Queue",
      icon: <LayoutList className="h-3.5 w-3.5" />,
    },
    {
      key: "accepted",
      label: "Accepted",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    {
      key: "declined",
      label: "Declined",
      icon: <XCircle className="h-3.5 w-3.5" />,
    },
    {
      key: "all",
      label: "All Logs",
      icon: <Layers className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <StandardPage
      eyebrow="Intelligence"
      title="Decision Ledger"
      description="Evaluate, score, and audit operational recommendations."
      width="xl"
      rhythm="comfortable"
      className="px-4 pb-20"
      parent={{ href: "/system", label: "system" }}
      actions={
        <button
          onClick={() => fetchOpportunities(activeTab)}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-control border border-edge-default bg-content px-3 py-2 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      }
    >

      {/* Tabs */}
      <div className="flex border-b border-edge-subtle mb-6 overflow-x-auto scrollbar-none gap-2">
        {tabs.map((tab) => {
          const isSelected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex min-h-[44px] items-center gap-2 border-b-2 px-4 py-3 text-[13px] font-medium transition-colors duration-[var(--motion-state)] ${
                isSelected
                  ? "border-accent text-fg"
                  : "border-transparent text-fg-tertiary hover:text-fg-secondary"
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Opportunities List */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-edge-subtle rounded-surface bg-content">
          <RefreshCw className="h-6 w-6 text-fg-tertiary animate-spin" />
          <span className="text-xs font-mono text-fg-tertiary">Loading ledger data...</span>
        </div>
      ) : opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-edge-subtle rounded-surface bg-content px-6">
          <div className="rounded-full bg-surface-interactive p-4 border border-edge-subtle text-fg-tertiary mb-4">
            <LayoutList className="h-8 w-8" />
          </div>
          <h3 className="text-sm font-semibold text-fg capitalize">No {activeTab} Opportunities</h3>
          <p className="text-xs text-fg-tertiary max-w-sm mt-1">
            {activeTab === "pending"
              ? "All opportunities have been processed. Tap compile on the briefing page to check for new ones."
              : `There are no opportunities marked as ${activeTab} yet.`}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {opportunities.map((opp) => (
            <OpportunityCard
              key={opp.id}
              opportunity={opp}
              onStatusChange={handleStatusChange}
            />
          ))}
        </div>
      )}
    </StandardPage>
  );
}
