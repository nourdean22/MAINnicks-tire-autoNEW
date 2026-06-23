"use client";

import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { RefreshCw, LayoutList, CheckCircle2, XCircle, Layers } from "lucide-react";
import { PageHeader } from "@/components/layout/ui";
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
      const data = await res.json();
      if (data.status === "success") {
        setOpportunities(data.opportunities || []);
      } else {
        setOpportunities([]);
      }
    } catch (err) {
      toast.error("Failed to load opportunities queue.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOpportunities(activeTab);
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
    <div className="max-w-5xl mx-auto px-4 pb-20">
      <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-6">
        <PageHeader eyebrow="INTELLIGENCE" title="Decision Ledger" description="Evaluate, score, and audit operational recommendations." />
        <button
          onClick={() => fetchOpportunities(activeTab)}
          disabled={loading}
          className="self-start flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950 text-xs font-mono text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          REFRESH
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-850 mb-6 overflow-x-auto scrollbar-none gap-2">
        {tabs.map((tab) => {
          const isSelected = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 border-b-2 px-4 py-3 text-xs font-medium tracking-wider uppercase transition-all ${
                isSelected
                  ? "border-indigo-500 text-slate-100"
                  : "border-transparent text-slate-500 hover:border-slate-800 hover:text-slate-300"
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
        <div className="flex flex-col items-center justify-center py-20 gap-3 border border-slate-800/40 rounded-2xl bg-slate-900/10 backdrop-blur-md">
          <RefreshCw className="h-6 w-6 text-slate-500 animate-spin" />
          <span className="text-xs font-mono text-slate-500">Loading ledger data...</span>
        </div>
      ) : opportunities.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-slate-800/40 rounded-2xl bg-slate-900/10 backdrop-blur-md px-6">
          <div className="rounded-full bg-slate-900/80 p-4 border border-slate-800 text-slate-500 mb-4">
            <LayoutList className="h-8 w-8" />
          </div>
          <h3 className="text-sm font-semibold text-slate-250 capitalize">No {activeTab} Opportunities</h3>
          <p className="text-xs text-slate-500 max-w-sm mt-1">
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
    </div>
  );
}
