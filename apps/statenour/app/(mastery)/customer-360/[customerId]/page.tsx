"use client";

/**
 * /customer-360/[customerId] · Wave-200 Phase 6 (2026-05-17)
 *
 * Single-pane Customer 360 view for any nickstire customer. Reads
 * the aggregated payload from /api/customer-360/[customerId] · shows:
 *   · customer header (name · phone · vehicle · LTV badge)
 *   · inferred preferences (summary line + sub-axes)
 *   · timeline tabs (invoices · estimates · ALG declined · callbacks)
 *   · bridge status banner (degraded · down) when applicable
 *
 * Loading state: simple skeleton.
 * Error state: explicit · retry button.
 *
 * Aesthetics: matches the editorial-minimalist principles in the
 * existing /command + /chat pages. Gold (#FDB913) for the LTV badge ·
 * white space dominant · zero gradients.
 *
 * See: docs/adr/0008-customer-360-predictive-brain.md
 */

import { use, useCallback, useEffect, useState } from "react";

interface CustomerPreferences {
  customerId: string;
  inferredAt: string;
  visitFrequency: string;
  paymentBehavior: string;
  conversionRate: number | null;
  declinedValueCents: number;
  avgTicketCents: number | null;
  ltvTier: "high" | "mid" | "low" | "unknown";
  hasOpenCallback: boolean;
  openRecoveryCount: number;
  summary: string;
}

interface Customer360Payload {
  customerId: string;
  bridgeStatus: "ok" | "degraded" | "down";
  detail: {
    customer: Record<string, unknown>;
    timeline: {
      invoices: Array<Record<string, unknown>>;
      estimates: Array<Record<string, unknown>>;
      algEstimates: Array<Record<string, unknown>>;
      callbacks: Array<Record<string, unknown>>;
    };
    counts: Record<string, number>;
  } | null;
  preferences: CustomerPreferences | null;
  fetchedAt: string;
}

type TabKey = "invoices" | "estimates" | "alg" | "callbacks";

const TAB_LABEL: Record<TabKey, string> = {
  invoices: "Invoices",
  estimates: "Estimates",
  alg: "ALG declined",
  callbacks: "Callbacks",
};

function formatMoney(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

interface PageProps {
  params: Promise<{ customerId: string }>;
}

export default function Customer360Page({ params }: PageProps) {
  const { customerId } = use(params);
  const [data, setData] = useState<Customer360Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("invoices");

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customer-360/${customerId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as Customer360Payload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  if (loading) return <SkeletonView />;
  if (error)
    return (
      <ErrorView
        error={error}
        onRetry={() => void fetchData()}
        customerId={customerId}
      />
    );
  if (!data) return null;

  const customer = data.detail?.customer as Record<string, unknown> | undefined;
  const prefs = data.preferences;
  const timeline = data.detail?.timeline;

  const fullName = customer
    ? [customer.firstName, customer.lastName].filter(Boolean).join(" ")
    : `Customer ${customerId}`;

  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Bridge banner */}
        {data.bridgeStatus !== "ok" ? (
          <div className="mb-6 rounded border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
            Bridge {data.bridgeStatus} ·{" "}
            {data.bridgeStatus === "degraded"
              ? "showing cached preferences only"
              : "no fresh data · showing what we last knew"}
          </div>
        ) : null}

        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-2">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-1">
              Customer 360
            </p>
            <h1 className="text-2xl font-medium">{fullName}</h1>
            <p className="text-sm text-white/50 mt-1">
              {(customer?.phone as string) ?? "no phone"} ·{" "}
              {[customer?.vehicleYear, customer?.vehicleMake, customer?.vehicleModel]
                .filter(Boolean)
                .join(" ") || "no vehicle"}
            </p>
          </div>
          {prefs?.ltvTier && prefs.ltvTier !== "unknown" ? (
            <span
              className={[
                "inline-flex items-center px-3 py-1 rounded-full text-xs font-medium uppercase tracking-wider",
                prefs.ltvTier === "high"
                  ? "bg-[#FDB913] text-black"
                  : prefs.ltvTier === "mid"
                  ? "bg-white/10 text-white/80"
                  : "bg-white/5 text-white/50",
              ].join(" ")}
            >
              {prefs.ltvTier} LTV
            </span>
          ) : null}
        </div>

        {/* Preferences summary line */}
        {prefs ? (
          <p className="mt-6 text-base text-white/80">{prefs.summary}</p>
        ) : (
          <p className="mt-6 text-sm text-white/40">
            No inferred preferences yet · the daily inference cron will populate
            this after the next run.
          </p>
        )}

        {/* Sub-axes grid */}
        {prefs ? (
          <dl className="mt-6 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <Stat label="Visits" value={prefs.visitFrequency} />
            <Stat label="Payment" value={prefs.paymentBehavior} />
            <Stat
              label="Avg ticket"
              value={formatMoney(prefs.avgTicketCents)}
            />
            <Stat
              label="Conversion"
              value={
                prefs.conversionRate != null
                  ? `${Math.round(prefs.conversionRate * 100)}%`
                  : "—"
              }
            />
            <Stat
              label="Declined value"
              value={formatMoney(prefs.declinedValueCents)}
            />
            <Stat
              label="Open recovery"
              value={String(prefs.openRecoveryCount)}
            />
          </dl>
        ) : null}

        {/* Timeline tabs */}
        {timeline ? (
          <div className="mt-12">
            <div
              role="tablist"
              className="flex flex-wrap gap-1 border-b border-white/10"
            >
              {(Object.keys(TAB_LABEL) as TabKey[]).map((k) => {
                const count =
                  k === "alg"
                    ? timeline.algEstimates.length
                    : timeline[k as keyof typeof timeline].length;
                return (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={[
                      "px-4 py-3 text-sm border-b-2 -mb-px transition",
                      tab === k
                        ? "border-[#FDB913] text-white"
                        : "border-transparent text-white/50 hover:text-white/80",
                    ].join(" ")}
                  >
                    {TAB_LABEL[k]} <span className="text-white/30">·</span>{" "}
                    {count}
                  </button>
                );
              })}
            </div>
            <div className="mt-6">
              {tab === "invoices" ? (
                <TimelineList rows={timeline.invoices} dateKey="invoiceDate" />
              ) : tab === "estimates" ? (
                <TimelineList rows={timeline.estimates} dateKey="createdAt" />
              ) : tab === "alg" ? (
                <TimelineList rows={timeline.algEstimates} dateKey="createdAt" />
              ) : (
                <TimelineList rows={timeline.callbacks} dateKey="createdAt" />
              )}
            </div>
          </div>
        ) : null}

        {/* Meta */}
        <p className="mt-12 text-[10px] uppercase tracking-[0.22em] text-white/30">
          fetched · {formatDate(data.fetchedAt)}
        </p>
      </div>
    </main>
  );
}

// ── small components ─────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.18em] text-white/40">
        {label}
      </dt>
      <dd className="mt-1 text-base text-white/90">{value}</dd>
    </div>
  );
}

function TimelineList({
  rows,
  dateKey,
}: {
  rows: Array<Record<string, unknown>>;
  dateKey: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-white/40 py-8 text-center">No rows.</p>
    );
  }
  return (
    <ul className="space-y-2">
      {rows.map((row, i) => {
        const date = row[dateKey] as string | null | undefined;
        const amount = Number(row.totalAmount);
        const status = (row.status ??
          row.paymentStatus ??
          "") as string;
        const label = (row.invoiceNumber ??
          row.estimateNumber ??
          row.name ??
          row.id ??
          `row-${i}`) as string;
        return (
          <li
            key={`${i}-${label}`}
            className="flex items-center justify-between py-3 border-b border-white/5 last:border-none"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{label}</p>
              <p className="text-xs text-white/50">
                {formatDate(date)}
                {status ? ` · ${status}` : ""}
              </p>
            </div>
            {Number.isFinite(amount) ? (
              <span className="text-sm text-white/80 tabular-nums">
                {formatMoney(amount)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SkeletonView() {
  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white">
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="h-3 w-24 bg-white/5 rounded mb-3" />
        <div className="h-7 w-64 bg-white/10 rounded mb-2" />
        <div className="h-4 w-48 bg-white/5 rounded" />
        <div className="mt-12 grid grid-cols-3 gap-4">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i}>
              <div className="h-2 w-16 bg-white/5 rounded mb-2" />
              <div className="h-5 w-24 bg-white/10 rounded" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function ErrorView({
  error,
  onRetry,
  customerId,
}: {
  error: string;
  onRetry: () => void;
  customerId: string;
}) {
  return (
    <main className="min-h-[100dvh] bg-[var(--bg-base)] text-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.18em] text-white/40 mb-3">
          Customer 360
        </p>
        <p className="text-sm text-red-300">{error}</p>
        <p className="text-[10px] uppercase tracking-[0.22em] text-white/30 mt-2">
          customer · {customerId}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-6 inline-flex items-center px-4 py-2 rounded border border-white/15 text-sm hover:bg-white/[0.04]"
        >
          retry
        </button>
      </div>
    </main>
  );
}
