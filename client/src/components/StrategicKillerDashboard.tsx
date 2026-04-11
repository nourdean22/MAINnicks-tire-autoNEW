/**
 * StrategicKillerDashboard — AI-powered lead prioritization dashboard.
 *
 * Displays analyzed leads with urgency, budget potential, killer score,
 * and a clear recommended action (CALL_NOW, SMS_ONLY, IGNORE) so the
 * sales team can act on the highest-value opportunities instantly.
 */

import { useState } from "react";
import { Loader2, Phone, MessageSquare, XCircle, Target } from "lucide-react";

interface Lead {
  name?: string;
  message?: string;
  [key: string]: unknown;
}

interface AnalyzedLead extends Lead {
  urgency: number;
  budgetPotential: number;
  killerScore: number;
  recommendedAction: "CALL_NOW" | "SMS_ONLY" | "IGNORE";
}

// ─── Example seed data shown before any analysis is run ──────────────────────
const EXAMPLE_LEADS: AnalyzedLead[] = [
  {
    name: "Sarah M.",
    message: "My brakes are making noise. Need it done ASAP.",
    urgency: 5,
    budgetPotential: 4,
    killerScore: 9,
    recommendedAction: "CALL_NOW",
  },
  {
    name: "James T.",
    message: "How much for an oil change? Just checking prices.",
    urgency: 1,
    budgetPotential: 2,
    killerScore: 3,
    recommendedAction: "SMS_ONLY",
  },
  {
    name: "Maria L.",
    message: "Need 4 new tires for my SUV before winter. Budget is flexible.",
    urgency: 3,
    budgetPotential: 5,
    killerScore: 8,
    recommendedAction: "CALL_NOW",
  },
];

// ─── Score bar component ──────────────────────────────────────────────────────
function ScoreBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-gray-400">
        <span>{label}</span>
        <span className="font-bold" style={{ color }}>
          {value}/{max}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-gray-700">
        <div
          className="h-1.5 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

// ─── Action badge ─────────────────────────────────────────────────────────────
function ActionBadge({
  action,
  onClick,
}: {
  action: "CALL_NOW" | "SMS_ONLY" | "IGNORE";
  onClick?: () => void;
}) {
  if (action === "CALL_NOW") {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 rounded-md bg-green-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-green-500 active:scale-95"
      >
        <Phone className="size-3.5" />
        CALL NOW
      </button>
    );
  }

  if (action === "SMS_ONLY") {
    return (
      <button
        onClick={onClick}
        className="flex items-center gap-1.5 rounded-md bg-yellow-600 px-3 py-1.5 text-sm font-bold text-white transition-colors hover:bg-yellow-500 active:scale-95"
      >
        <MessageSquare className="size-3.5" />
        SMS ONLY
      </button>
    );
  }

  return (
    <span className="flex items-center gap-1.5 rounded-md bg-gray-700 px-3 py-1.5 text-sm font-bold text-gray-400">
      <XCircle className="size-3.5" />
      IGNORE
    </span>
  );
}

// ─── Lead card ────────────────────────────────────────────────────────────────
function LeadCard({ lead }: { lead: AnalyzedLead }) {
  const killerColor =
    lead.killerScore >= 8
      ? "#ef4444"
      : lead.killerScore >= 5
        ? "#f97316"
        : "#6b7280";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-red-900/40 bg-gray-800 p-4 shadow-lg">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-white">{lead.name || "Unknown Lead"}</p>
          <p className="mt-0.5 text-sm text-gray-400 line-clamp-2">
            {lead.message || "No message provided"}
          </p>
        </div>
        {/* Killer score badge */}
        <div
          className="flex shrink-0 flex-col items-center rounded-lg border px-2.5 py-1"
          style={{ borderColor: killerColor }}
        >
          <span className="text-xs font-semibold text-gray-400">SCORE</span>
          <span className="text-xl font-black" style={{ color: killerColor }}>
            {lead.killerScore}
          </span>
        </div>
      </div>

      {/* Score bars */}
      <div className="flex flex-col gap-2">
        <ScoreBar
          label="Urgency"
          value={lead.urgency}
          max={5}
          color="#ef4444"
        />
        <ScoreBar
          label="Budget Potential"
          value={lead.budgetPotential}
          max={5}
          color="#f97316"
        />
      </div>

      {/* Action */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">Recommended Action</span>
        <ActionBadge action={lead.recommendedAction} />
      </div>
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────
export function StrategicKillerDashboard() {
  const [leads, setLeads] = useState<AnalyzedLead[]>(EXAMPLE_LEADS);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sort by killer score descending
  const sorted = [...leads].sort((a, b) => b.killerScore - a.killerScore);

  const callNowCount = leads.filter((l) => l.recommendedAction === "CALL_NOW").length;
  const smsCount = leads.filter((l) => l.recommendedAction === "SMS_ONLY").length;
  const ignoreCount = leads.filter((l) => l.recommendedAction === "IGNORE").length;

  async function handleReAnalyze() {
    setIsAnalyzing(true);
    setError(null);
    try {
      const res = await fetch("/api/nour-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leads: leads.map(({ name, message }) => ({ name, message })),
        }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { analyzed: AnalyzedLead[] };
      setLeads(data.analyzed);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-900 p-6 font-sans">
      {/* ── Header ── */}
      <div className="mb-6 flex flex-col gap-1 border-b border-red-900/50 pb-5">
        <div className="flex items-center gap-3">
          <Target className="size-7 text-red-500" />
          <h1 className="text-2xl font-black tracking-tight text-red-500">
            🎯 STRATEGIC KILLER DASHBOARD
          </h1>
        </div>
        <p className="ml-10 text-sm text-gray-500">
          AI-powered lead prioritization — act on what matters, ignore the rest.
        </p>
      </div>

      {/* ── Stats strip ── */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-green-900/40 bg-gray-800 p-3 text-center">
          <p className="text-2xl font-black text-green-400">{callNowCount}</p>
          <p className="text-xs font-semibold text-gray-400">CALL NOW</p>
        </div>
        <div className="rounded-lg border border-yellow-900/40 bg-gray-800 p-3 text-center">
          <p className="text-2xl font-black text-yellow-400">{smsCount}</p>
          <p className="text-xs font-semibold text-gray-400">SMS ONLY</p>
        </div>
        <div className="rounded-lg border border-gray-700 bg-gray-800 p-3 text-center">
          <p className="text-2xl font-black text-gray-500">{ignoreCount}</p>
          <p className="text-xs font-semibold text-gray-400">IGNORE</p>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div className="mb-4 rounded-lg border border-red-700 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* ── Lead cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {sorted.map((lead, i) => (
          <LeadCard key={i} lead={lead} />
        ))}
      </div>

      {/* ── Re-analyze button ── */}
      <div className="mt-6 flex justify-center">
        <button
          onClick={handleReAnalyze}
          disabled={isAnalyzing}
          className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/30 px-6 py-2.5 text-sm font-bold text-red-400 transition-colors hover:bg-red-900/60 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Target className="size-4" />
              Re-Analyze with AI
            </>
          )}
        </button>
      </div>
    </div>
  );
}
