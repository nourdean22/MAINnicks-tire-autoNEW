"use client";

import { useState, useEffect } from "react";
import { StandardPage } from "@/components/layout/standard-page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { logger } from "@/lib/logger";

const log = logger.withSurface("wealth-dashboard");

interface Holding {
  id: string;
  symbol: string;
  name: string;
  shares: string;
  costBasisCents: number;
  currentPriceCents: number;
  lastUpdatedAt: string;
  totalHoldingCost: number;
  totalHoldingValue: number;
  gainLossCents: number;
  gainLossPct: number;
}

interface WealthData {
  holdings: Holding[];
  summary: {
    totalCostCents: number;
    totalValueCents: number;
    portfolioGainLossCents: number;
    portfolioGainLossPct: number;
  };
}

export default function WealthPage() {
  const [data, setData] = useState<WealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [showAddForm, setShowAddForm] = useState(false);
  const [symbol, setSymbol] = useState("");
  const [name, setName] = useState("");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/wealth");
      if (!res.ok) throw new Error("Failed to load wealth portfolio");
      const json = await res.json();
      setData(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
      log.error("load_wealth_failed", { error: String(e) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleAddHolding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!symbol || !name || !shares || !costBasis || !currentPrice) return;

    setSubmitting(true);
    try {
      const res = await fetch("/api/wealth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          name,
          shares: parseFloat(shares),
          costBasisCents: Math.round(parseFloat(costBasis) * 100),
          currentPriceCents: Math.round(parseFloat(currentPrice) * 100),
        }),
      });

      if (!res.ok) throw new Error("Failed to save holding");
      setSymbol("");
      setName("");
      setShares("");
      setCostBasis("");
      setCurrentPrice("");
      setShowAddForm(false);
      fetchData();
    } catch (e) {
      alert("Error saving holding: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshPrices = async () => {
    setRefreshing(true);
    setRefreshMsg(null);
    try {
      const res = await fetch("/api/wealth/refresh-prices", { method: "POST" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Refresh failed");
      const { updated, total, failed } = json.data as { updated: number; total: number; failed: string[] };
      let msg = `Updated ${updated} of ${total} holding${total === 1 ? "" : "s"} from live quotes.`;
      if (failed && failed.length) msg += ` Couldn't price: ${failed.join(", ")}.`;
      setRefreshMsg(msg);
      fetchData();
    } catch (e) {
      setRefreshMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setRefreshing(false);
    }
  };

  const handleDeleteHolding = async (id: string, symbol: string) => {
    if (!confirm(`Are you sure you want to delete ${symbol} from your portfolio?`)) return;

    try {
      const res = await fetch(`/api/wealth?id=${id}`, {
        method: "DELETE",
      });

      if (!res.ok) throw new Error("Failed to delete holding");
      fetchData();
    } catch (e) {
      alert("Delete failed: " + (e instanceof Error ? e.message : String(e)));
    }
  };

  const formatCurrency = (cents: number) => {
    const dollars = cents / 100;
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(dollars);
  };

  return (
    <StandardPage
      eyebrow="mastery · investments"
      title="wealth intelligence"
      description="Consolidated assets, portfolio tracking, and net worth indicator board."
      width="2xl"
      rhythm="comfortable"
      loading={loading && !data}
      actions={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={refreshing || !data?.holdings.length}
            onClick={handleRefreshPrices}
            className="text-[11px] font-mono uppercase tracking-wider"
          >
            {refreshing ? "Refreshing..." : "Refresh Prices"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-[11px] font-mono uppercase tracking-wider"
          >
            {showAddForm ? "Cancel" : "+ Add Asset"}
          </Button>
        </div>
      }
    >
      {error && (
        <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-4 text-sm text-rose-300">
          Error loading portfolio: {error}
        </div>
      )}

      {refreshMsg && (
        <div className="rounded-lg border border-[var(--gold)]/20 bg-[var(--gold)]/[0.04] px-4 py-2 text-xs font-mono text-[var(--text-secondary)]">
          {refreshMsg}
        </div>
      )}

      {/* Summary Stats */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Total Invested Cost
            </span>
            <div className="text-xl font-mono font-bold text-[var(--text-primary)] mt-1">
              {formatCurrency(data.summary.totalCostCents)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Current Market Value
            </span>
            <div className="text-xl font-mono font-bold text-emerald-400 mt-1">
              {formatCurrency(data.summary.totalValueCents)}
            </div>
          </div>
          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] p-3">
            <span className="text-[10px] uppercase tracking-wider text-[var(--text-tertiary)]">
              Total Gain / Loss
            </span>
            <div
              className={`text-xl font-mono font-bold mt-1 ${
                data.summary.portfolioGainLossCents >= 0 ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {formatCurrency(data.summary.portfolioGainLossCents)}
              <span className="text-xs ml-1.5 font-sans font-normal">
                ({data.summary.portfolioGainLossPct.toFixed(2)}%)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Add Holding Form */}
      {showAddForm && (
        <form
          onSubmit={handleAddHolding}
          className="rounded-lg border border-[var(--gold)]/20 bg-[var(--bg-raised)] p-4 space-y-3"
        >
          <h3 className="text-sm font-semibold uppercase tracking-wider text-[var(--gold)]">
            Add or Update Investment
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Ticker / Symbol
              </label>
              <input
                type="text"
                required
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. AAPL, BTC"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Asset Name
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. Apple Inc, Bitcoin"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Shares / Quantity
              </label>
              <input
                type="number"
                step="any"
                required
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. 10.5"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Avg Cost per Share ($)
              </label>
              <input
                type="number"
                step="any"
                required
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. 150.25"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] mb-1">
                Current Price per Share ($)
              </label>
              <input
                type="number"
                step="any"
                required
                value={currentPrice}
                onChange={(e) => setCurrentPrice(e.target.value)}
                className="w-full rounded border border-[var(--border-default)] bg-[var(--bg-base)] px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--gold)]"
                placeholder="e.g. 182.30"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={submitting}
            className="text-xs uppercase tracking-wider bg-[var(--gold)] text-black hover:bg-[var(--gold)]/80"
          >
            {submitting ? "Saving..." : "Save Holding"}
          </Button>
        </form>
      )}

      {/* Holdings list */}
      <div className="space-y-2">
        <h2 className="text-xs font-mono uppercase tracking-widest text-[var(--text-tertiary)] px-1">
          Asset Portfolio
        </h2>

        <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-base)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-default)] bg-zinc-950/40 text-[10px] uppercase tracking-wider text-[var(--text-tertiary)] font-mono">
                  <th className="p-3">Asset</th>
                  <th className="p-3 text-right">Shares</th>
                  <th className="p-3 text-right">Avg Cost</th>
                  <th className="p-3 text-right">Current Price</th>
                  <th className="p-3 text-right">Total Cost</th>
                  <th className="p-3 text-right">Market Value</th>
                  <th className="p-3 text-right">Gain / Loss</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-900 text-xs">
                {data?.holdings.map((h) => {
                  const isGain = h.gainLossCents >= 0;

                  return (
                    <tr key={h.id} className="hover:bg-zinc-900/20 transition-all">
                      <td className="p-3">
                        <div className="font-semibold text-[var(--text-primary)]">
                          {h.symbol}
                        </div>
                        <div className="text-[10px] text-[var(--text-tertiary)]">
                          {h.name}
                        </div>
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                        {Number(h.shares).toFixed(4)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                        {formatCurrency(h.costBasisCents)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                        {formatCurrency(h.currentPriceCents)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-secondary)]">
                        {formatCurrency(h.totalHoldingCost)}
                      </td>
                      <td className="p-3 text-right font-mono text-[var(--text-primary)] font-semibold">
                        {formatCurrency(h.totalHoldingValue)}
                      </td>
                      <td className={`p-3 text-right font-mono font-semibold ${isGain ? "text-emerald-400" : "text-rose-400"}`}>
                        <div>{formatCurrency(h.gainLossCents)}</div>
                        <div className="text-[10px] font-normal">
                          {isGain ? "+" : ""}
                          {h.gainLossPct.toFixed(2)}%
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleDeleteHolding(h.id, h.symbol)}
                          className="text-[10px] uppercase font-mono tracking-wider text-rose-400/80 hover:text-rose-400 hover:underline"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {data?.holdings.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center p-6 text-sm text-[var(--text-tertiary)]">
                      No assets added yet. Use the button above to add your first holding.
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
