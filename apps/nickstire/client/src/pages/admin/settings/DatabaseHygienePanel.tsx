import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { confirmDialog } from "@/components/admin/ConfirmDialog";
import {
  Database, Trash2, ShieldAlert, RefreshCw, Layers, Clock, Check, AlertTriangle
} from "lucide-react";
import { formatDateTime } from "../shared";

type RecordItem = {
  id: number;
  name: string;
  phone: string;
  createdAt: string;
  details: string;
  table: "leads" | "bookings" | "callbacks";
};

function getRelativeTime(date: Date) {
  const ms = Date.now() - date.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days > 365) {
    const years = Math.floor(days / 365);
    return `${years}y ago`;
  }
  if (days > 30) {
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  }
  if (days > 0) {
    return `${days}d ago`;
  }
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours > 0) {
    return `${hours}h ago`;
  }
  const mins = Math.floor(ms / (1000 * 60));
  if (mins > 0) {
    return `${mins}m ago`;
  }
  return "just now";
}

export default function DatabaseHygienePanel() {
  const utils = trpc.useUtils();
  const [selectedFake, setSelectedFake] = useState<Record<number, boolean>>({});
  const [selectedDuplicates, setSelectedDuplicates] = useState<Record<number, boolean>>({});
  const [selectedStale, setSelectedStale] = useState<Record<number, boolean>>({});
  const [activeTab, setActiveTab] = useState<"fake" | "duplicates" | "stale">("fake");

  const { data, isLoading, isRefetching, refetch } = trpc.adminDashboard.dbCleanupScan.useQuery(undefined, {
    staleTime: 60000,
  });

  useEffect(() => {
    if (data) {
      // Auto-select all by default to make pruning quick
      const fakeMap: Record<number, boolean> = {};
      const dupMap: Record<number, boolean> = {};
      const staleMap: Record<number, boolean> = {};

      data.fake.forEach((item: RecordItem) => {
        fakeMap[item.id] = true;
      });
      data.duplicates.forEach((item: RecordItem) => {
        dupMap[item.id] = true;
      });
      data.stale.forEach((item: RecordItem) => {
        staleMap[item.id] = true;
      });

      setSelectedFake(fakeMap);
      setSelectedDuplicates(dupMap);
      setSelectedStale(staleMap);
    }
  }, [data]);

  const pruneMut = trpc.adminDashboard.dbCleanupPrune.useMutation({
    onSuccess: (result) => {
      toast.success(`Hygiene action successful! Deleted ${result.deleted} records, archived ${result.archived} records.`);
      refetch();
      utils.adminDashboard.siteHealth.invalidate();
    },
    onError: (err) => {
      toast.error(`Hygiene prune failed: ${err.message}`);
    }
  });

  const handlePrune = async () => {
    if (!data) return;

    const fakeToPrune = data.fake.filter((item: RecordItem) => selectedFake[item.id]).map((item: RecordItem) => ({ id: item.id, table: item.table }));
    const duplicatesToPrune = data.duplicates.filter((item: RecordItem) => selectedDuplicates[item.id]).map((item: RecordItem) => ({ id: item.id, table: item.table }));
    const staleToPrune = data.stale.filter((item: RecordItem) => selectedStale[item.id]).map((item: RecordItem) => ({ id: item.id, table: item.table }));

    const totalToPrune = fakeToPrune.length + duplicatesToPrune.length + staleToPrune.length;
    if (totalToPrune === 0) {
      toast.error("No records selected for pruning.");
      return;
    }

    const ok = await confirmDialog({
      title: "Confirm Database Pruning?",
      message: `You are about to delete ${fakeToPrune.length + duplicatesToPrune.length} fake/duplicate entries permanently and archive/close ${staleToPrune.length} stale entries. This action cannot be undone.`,
      confirmLabel: "Proceed with Pruning",
      cancelLabel: "Cancel",
      tone: "danger"
    });

    if (!ok) return;

    pruneMut.mutate({
      fakeIds: fakeToPrune,
      duplicateIds: duplicatesToPrune,
      staleIds: staleToPrune
    });
  };

  const toggleSelectAll = (tab: "fake" | "duplicates" | "stale") => {
    if (!data) return;
    if (tab === "fake") {
      const allSelected = data.fake.every((item: RecordItem) => selectedFake[item.id]);
      const newMap: Record<number, boolean> = {};
      data.fake.forEach((item: RecordItem) => {
        newMap[item.id] = !allSelected;
      });
      setSelectedFake(newMap);
    } else if (tab === "duplicates") {
      const allSelected = data.duplicates.every((item: RecordItem) => selectedDuplicates[item.id]);
      const newMap: Record<number, boolean> = {};
      data.duplicates.forEach((item: RecordItem) => {
        newMap[item.id] = !allSelected;
      });
      setSelectedDuplicates(newMap);
    } else if (tab === "stale") {
      const allSelected = data.stale.every((item: RecordItem) => selectedStale[item.id]);
      const newMap: Record<number, boolean> = {};
      data.stale.forEach((item: RecordItem) => {
        newMap[item.id] = !allSelected;
      });
      setSelectedStale(newMap);
    }
  };

  const getRecordCheckbox = (item: RecordItem, tab: "fake" | "duplicates" | "stale") => {
    const isChecked = tab === "fake" ? !!selectedFake[item.id] : tab === "duplicates" ? !!selectedDuplicates[item.id] : !!selectedStale[item.id];
    const setChecked = (val: boolean) => {
      if (tab === "fake") {
        setSelectedFake(prev => ({ ...prev, [item.id]: val }));
      } else if (tab === "duplicates") {
        setSelectedDuplicates(prev => ({ ...prev, [item.id]: val }));
      } else if (tab === "stale") {
        setSelectedStale(prev => ({ ...prev, [item.id]: val }));
      }
    };

    return (
      <input
        type="checkbox"
        checked={isChecked}
        disabled={pruneMut.isPending}
        onChange={(e) => setChecked(e.target.checked)}
        className="w-4 h-4 rounded border-border/40 text-primary focus:ring-primary/40 focus:ring-2 accent-primary disabled:opacity-50 disabled:cursor-not-allowed"
      />
    );
  };

  if (isLoading) {
    return (
      <div className="bg-card border border-border/30 p-6">
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin text-primary mr-3" />
          <span className="text-[13px] text-foreground/50">Scanning database for hygiene signals...</span>
        </div>
      </div>
    );
  }

  const fakeCount = data?.fake.length ?? 0;
  const dupCount = data?.duplicates.length ?? 0;
  const staleCount = data?.stale.length ?? 0;
  const totalCount = fakeCount + dupCount + staleCount;

  const selectedFakeCount = Object.values(selectedFake).filter(Boolean).length;
  const selectedDupCount = Object.values(selectedDuplicates).filter(Boolean).length;
  const selectedStaleCount = Object.values(selectedStale).filter(Boolean).length;
  const totalSelectedCount = selectedFakeCount + selectedDupCount + selectedStaleCount;

  const activeRecords = activeTab === "fake" ? (data?.fake ?? []) : activeTab === "duplicates" ? (data?.duplicates ?? []) : (data?.stale ?? []);
  const activeSelectedMap = activeTab === "fake" ? selectedFake : activeTab === "duplicates" ? selectedDuplicates : selectedStale;
  const isAllActiveSelected = activeRecords.length > 0 && activeRecords.every((item: RecordItem) => activeSelectedMap[item.id]);

  return (
    <div className="bg-card border border-border/30 p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-4 border-b border-border/10 pb-4">
        <div className="space-y-1">
          <h3 className="font-bold text-sm tracking-wide text-foreground flex items-center gap-2">
            <Database className="w-4 h-4 text-primary" />
            DATABASE HYGIENE &amp; CLEANUP
          </h3>
          <p className="text-foreground/50 text-[11px]">
            Scan and prune fake leads, duplicates, and stale records. Ensures dashboard statistics reflect real shop operations.
          </p>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isRefetching || pruneMut.isPending}
          className="inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.1em] uppercase px-3 py-1.5 border border-border/30 hover:border-primary/40 rounded transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefetching ? "animate-spin" : ""}`} />
          {isRefetching ? "Scanning..." : "Rescan DB"}
        </button>
      </div>

      {totalCount === 0 ? (
        <div className="flex items-center gap-2.5 p-4 border border-emerald-500/20 bg-emerald-500/5 rounded">
          <Check className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-[13px] text-foreground/70">Database is perfectly clean! No fake, duplicate, or stale records detected.</span>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button
              type="button"
              onClick={() => setActiveTab("fake")}
              className={`p-3 border text-left rounded transition-colors ${
                activeTab === "fake"
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-border/20 hover:border-border/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-sans">Fake / Test Leads</span>
                <ShieldAlert className={`w-3.5 h-3.5 ${fakeCount > 0 ? "text-red-400 animate-pulse" : "text-foreground/30"}`} />
              </div>
              <p className="font-bold text-xl text-foreground mt-1">{fakeCount}</p>
              <p className="text-[10px] text-foreground/40 mt-0.5">Placeholder name/phone</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("duplicates")}
              className={`p-3 border text-left rounded transition-colors ${
                activeTab === "duplicates"
                  ? "border-amber-500/30 bg-amber-500/5"
                  : "border-border/20 hover:border-border/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-sans">Duplicates</span>
                <Layers className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <p className="font-bold text-xl text-foreground mt-1">{dupCount}</p>
              <p className="text-[10px] text-foreground/40 mt-0.5">Submitted within 24h</p>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("stale")}
              className={`p-3 border text-left rounded transition-colors ${
                activeTab === "stale"
                  ? "border-primary/30 bg-primary/5"
                  : "border-border/20 hover:border-border/40"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-foreground/50 font-sans">Stale (&gt;90d)</span>
                <Clock className="w-3.5 h-3.5 text-primary" />
              </div>
              <p className="font-bold text-xl text-foreground mt-1">{staleCount}</p>
              <p className="text-[10px] text-foreground/40 mt-0.5">New, unactioned records</p>
            </button>
          </div>

          {/* Active List */}
          <div className="border border-border/20 rounded">
            <div className="bg-foreground/[0.02] border-b border-border/20 px-4 py-2.5 flex items-center justify-between">
              <span className="text-[11px] font-bold text-foreground/60 tracking-wider uppercase">
                {activeTab === "fake" ? "Fake / Test Entries (Class 1)" : activeTab === "duplicates" ? "Duplicate Entries (Class 2)" : "Stale Entries (Class 3)"}
              </span>
              <button
                type="button"
                onClick={() => toggleSelectAll(activeTab)}
                disabled={pruneMut.isPending}
                className="text-[10px] font-bold text-primary hover:text-primary/80 transition-colors uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isAllActiveSelected ? "Deselect All" : "Select All"}
              </button>
            </div>

            {activeRecords.length === 0 ? (
              <div className="p-8 text-center text-foreground/40 text-[12px]">
                No records found in this category.
              </div>
            ) : (
              <div className="divide-y divide-border/10 max-h-[300px] overflow-y-auto">
                {activeRecords.map((item: RecordItem) => (
                  <div key={`${item.table}-${item.id}`} className="flex items-center justify-between gap-4 p-3 hover:bg-foreground/[0.01] transition-colors">
                    <div className="flex items-center gap-3 min-w-0">
                      {getRecordCheckbox(item, activeTab)}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[12px] font-semibold text-foreground">{item.name}</span>
                          <span className="text-[11px] text-foreground/50 font-mono">{item.phone}</span>
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded bg-foreground/10 text-foreground/60 font-mono tracking-wider">
                            {item.table} #{item.id}
                          </span>
                        </div>
                        {item.details && (
                          <p className="text-[10px] text-foreground/40 mt-0.5 truncate max-w-lg">{item.details}</p>
                        )}
                      </div>
                    </div>
                    <span className="text-[10px] text-foreground/40 whitespace-nowrap">
                      {formatDateTime(new Date(item.createdAt))} ({getRelativeTime(new Date(item.createdAt))})
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between flex-wrap gap-4 pt-2">
            <div className="text-[11.5px] text-foreground/50">
              Selected: <span className="font-semibold text-foreground">{totalSelectedCount}</span> of <span className="font-semibold text-foreground">{totalCount}</span> flagged records.
            </div>
            <button
              type="button"
              onClick={handlePrune}
              disabled={totalSelectedCount === 0 || pruneMut.isPending}
              className={`inline-flex items-center gap-1.5 text-[11px] font-bold tracking-[0.15em] uppercase px-4 py-2 rounded transition-colors focus:outline-none focus:ring-2 focus:ring-red-500/40 ${
                totalSelectedCount > 0
                  ? "bg-red-500 hover:bg-red-600 text-white cursor-pointer"
                  : "bg-border/20 text-foreground/20 cursor-not-allowed border border-border/10"
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {pruneMut.isPending ? "Executing..." : "Prune Selected"}
            </button>
          </div>
        </div>
      )}

      {/* Warning Guardrails Info */}
      <div className="p-3.5 border border-amber-500/20 bg-amber-500/5 rounded flex gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-[11px] text-foreground/60 space-y-1">
          <p className="font-semibold text-amber-400 uppercase tracking-wider">Hygiene Action Guardrails</p>
          <p>
            • **Fake/Test &amp; Duplicate** entries are permanently deleted to keep tables and reports clean.
          </p>
          <p>
            • **Stale** entries (new leads/bookings &gt;90d) are **archived / closed** instead of deleted to protect historical revenue data.
          </p>
          <p>
            • All actions are logged to the Admin Action Audit Trail for accountability.
          </p>
        </div>
      </div>
    </div>
  );
}
