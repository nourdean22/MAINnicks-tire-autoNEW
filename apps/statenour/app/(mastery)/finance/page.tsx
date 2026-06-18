"use client";

import { useState, useEffect } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

const log = logger.withSurface("finance-dashboard");

interface Transaction {
  id: string;
  date: string;
  amountCents: number;
  payee: string;
  category: string;
  plaidTransactionId: string | null;
  manualOverrideCategory: string | null;
  notes: string | null;
}

interface FinanceData {
  transactions: Transaction[];
  summary: {
    totalIncomeCents: number;
    totalExpensesCents: number;
    netCents: number;
  };
  categoryBreakdown: Record<string, number>;
}

export default function FinancePage() {
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File upload state
  const [csvFileContent, setCsvFileContent] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState<string>("");
  const [syncing, setSyncing] = useState(false);

  // Editing state
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [editCategory, setEditCategory] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/finance");
      if (!res.ok) throw new Error("Failed to load financial ledger");
      const json = await res.json();
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      log.error("load_finance_failed", { error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvFileContent(text);
      setUploadStatus(`File loaded: ${file.name} (${text.split("\n").length} lines)`);
    };
    reader.readAsText(file);
  };

  const handleSyncCSV = async () => {
    if (!csvFileContent) return;

    setSyncing(true);
    setUploadStatus("Uploading & Syncing...");
    try {
      const res = await fetch("/api/finance/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv: csvFileContent }),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Sync failed");
      }

      const json = await res.json();
      setUploadStatus(
        `Successfully synced! Imported: ${json.data.imported}, Skipped duplicates: ${json.data.skipped}`
      );
      setCsvFileContent("");
      fetchData();
    } catch (e) {
      setUploadStatus("Sync failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSyncing(false);
    }
  };

  const handleStartEdit = (tx: Transaction) => {
    setEditingTxId(tx.id);
    setEditCategory(tx.manualOverrideCategory || tx.category || "");
    setEditNotes(tx.notes || "");
  };

  const handleSaveEdit = async (id: string) => {
    setUpdating(true);
    try {
      const res = await fetch("/api/finance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          manualOverrideCategory: editCategory || null,
          notes: editNotes || null,
        }),
      });

      if (!res.ok) throw new Error("Failed to update transaction");
      setEditingTxId(null);
      fetchData();
    } catch (e) {
      alert("Update failed: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setUpdating(false);
    }
  };

  const formatCurrency = (cents: number) => {
    const dollars = cents / 100;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
  };

  return (
    <StandardPage
      eyebrow="mastery · ledger"
      title="financial ledger"
      description="Manual CSV statement uploader and AI-categorized bookkeeping pipeline."
      width="2xl"
      rhythm="comfortable"
      loading={loading && !data}
    >
      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-4 text-sm text-rose-300">
          Error loading ledger: {error}
        </div>
      )}

      {/* Financial Summary Cards */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Total Income
            </span>
            <div className="text-xl font-mono font-bold text-emerald-400 mt-1">
              {formatCurrency(data.summary.totalIncomeCents)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Total Expenses
            </span>
            <div className="text-xl font-mono font-bold text-rose-400 mt-1">
              {formatCurrency(data.summary.totalExpensesCents)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Net Cash Flow
            </span>
            <div
              className={`text-xl font-mono font-bold mt-1 ${
                data.summary.netCents >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCurrency(data.summary.netCents)}
            </div>
          </div>
        </div>
      )}

      {/* CSV Uploader */}
      <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/20 p-4 space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
          Manual Statement CSV Parser
        </h3>
        <div className="flex flex-col sm:flex-row gap-3 items-center">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="text-xs text-[var(--text-secondary)] file:mr-3 file:py-1 file:px-2 file:rounded file:border file:border-zinc-700 file:bg-zinc-900 file:text-[var(--text-secondary)] file:cursor-pointer hover:file:bg-zinc-800"
          />
          {csvFileContent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={syncing}
              onClick={handleSyncCSV}
              className="text-xs uppercase tracking-wider"
            >
              {syncing ? "Syncing..." : "Process & Load"}
            </Button>
          )}
        </div>
        {uploadStatus && (
          <p className="text-[11px] font-mono text-[var(--text-secondary)] bg-zinc-900/60 p-2 rounded">
            {uploadStatus}
          </p>
        )}
      </div>

      {/* Transactions list */}
      <div className="space-y-2">
        <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] px-1">
          Transaction Ledger
        </h2>

        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-zinc-950/40 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-mono">
                  <th className="p-3">Date</th>
                  <th className="p-3">Payee</th>
                  <th className="p-3">Category</th>
                  <th className="p-3 text-right">Amount</th>
                  <th className="p-3">Notes</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-xs">
                {data?.transactions.map((tx) => {
                  const isEditing = editingTxId === tx.id;
                  const isExpense = tx.amountCents < 0;
                  const displayCategory = tx.manualOverrideCategory || tx.category || "Uncategorized";

                  return (
                    <tr key={tx.id} className="hover:bg-zinc-900/20 transition-all">
                      <td className="p-3 font-mono text-[var(--text-secondary)]">
                        {/* Render in UTC: CSV dates are stored as UTC midnight (see finance.ts dedup hash),
                            so a local-tz render shifts them back a calendar day in negative offsets (e.g. ET). */}
                        {new Date(tx.date).toLocaleDateString("en-US", { timeZone: "UTC" })}
                      </td>
                      <td className="p-3 font-semibold text-[var(--text-primary)]">
                        {tx.payee}
                      </td>
                      <td className="p-3">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none"
                          />
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Badge className="bg-zinc-900 text-[10px] border border-zinc-800 text-[var(--text-secondary)]">
                              {displayCategory}
                            </Badge>
                            {tx.manualOverrideCategory && (
                              <span className="text-[9px] uppercase tracking-wider text-[var(--gold)]/60 font-mono">
                                Manual
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className={`p-3 text-right font-mono font-semibold ${isExpense ? "text-rose-400" : "text-emerald-400"}`}>
                        {formatCurrency(tx.amountCents)}
                      </td>
                      <td className="p-3 max-w-[200px] truncate text-[var(--text-secondary)]">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.target.value)}
                            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-[var(--text-primary)] w-full focus:outline-none"
                          />
                        ) : (
                          tx.notes || "—"
                        )}
                      </td>
                      <td className="p-3 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1.5">
                            <button
                              onClick={() => handleSaveEdit(tx.id)}
                              disabled={updating}
                              className="text-[10px] uppercase font-mono tracking-wider text-emerald-400 hover:underline"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingTxId(null)}
                              className="text-[10px] uppercase font-mono tracking-wider text-zinc-400 hover:underline"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => handleStartEdit(tx)}
                            className="text-[10px] uppercase font-mono tracking-wider text-[var(--gold)] hover:underline"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {data?.transactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center p-6 text-sm text-[var(--text-tertiary)]">
                      No transactions found. Upload a CSV file to load bank statement data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </StandardPage>
  );
}
