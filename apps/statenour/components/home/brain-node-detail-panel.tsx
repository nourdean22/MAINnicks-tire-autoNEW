"use client";

import { useRouter } from "next/navigation";
import { X, MessageSquare, ArrowRight, Compass, ShieldAlert, Zap, User, Target, ListTodo, FileText, Settings, HeartPulse, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { BrainGraphNode } from "@/lib/brain/brain-graph";

interface BrainNodeDetailPanelProps {
  node: BrainGraphNode;
  onClose: () => void;
  onFocusNode: (id: string) => void;
}

const TYPE_ICONS: Record<string, any> = {
  task: ListTodo,
  goal: Target,
  mission: Sparkles,
  memory: FileText,
  journal: FileText,
  decision: ShieldAlert,
  person: User,
  system: Settings,
  business: Settings,
  project: Sparkles,
};

export function BrainNodeDetailPanel({ node, onClose, onFocusNode }: BrainNodeDetailPanelProps) {
  const router = useRouter();

  const whyMatters = (node.metadata?.why as string) || getFallbackWhy(node);
  const nextMove = (node.metadata?.nextMove as string) || getFallbackNextMove(node);
  const riskOpportunity = getRiskOpportunity(node);
  const leverageText = getLeverage(node);

  const IconComponent = TYPE_ICONS[node.type] || FileText;

  // Ask Nick about this node
  const handleAskNick = () => {
    const promptText = `Analyze this brain node and tell me the next best move:

Node: ${node.label}
Type: ${node.type.toUpperCase()}
Status: ${node.status?.toUpperCase() || "ACTIVE"}
Why this matters: ${whyMatters}
Next best move: ${nextMove}
Known context: ${JSON.stringify(node.metadata || {})}`;

    try {
      sessionStorage.setItem("chat:seed", promptText);
    } catch (e) {
      // Graceful fallback
    }
    router.push("/chat");
  };

  const handleOpenPage = () => {
    if (node.href) {
      router.push(node.href);
    }
  };

  return (
    <div className="absolute right-3 top-16 bottom-3 w-80 max-w-full glass-card border-(--border-default) bg-[#0A0A0A]/95 backdrop-blur-md shadow-2xl flex flex-col z-20 animate-fade-in-scale">
      {/* Panel Header */}
      <div className="flex items-center justify-between pb-3 border-b border-(--border-default)">
        <div className="flex items-center gap-2">
          <IconComponent size={14} className="text-(--gold)" />
          <span className="text-[9px] font-mono uppercase tracking-[0.18em] text-(--text-tertiary)">
            {node.type}
          </span>
          {node.status && (
            <span
              className={cn(
                "inline-flex items-center gap-1 px-1.5 py-0.25 rounded text-[8px] font-semibold font-mono uppercase tracking-wider border",
                node.status === "risk" && "bg-rose-500/10 border-rose-500/20 text-rose-400",
                node.status === "opportunity" && "bg-(--gold)/10 border-(--gold)/20 text-(--gold)",
                node.status === "done" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
                node.status === "stale" && "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
                node.status === "active" && "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
              )}
            >
              <span
                className={cn(
                  "h-1 w-1 rounded-full",
                  node.status === "risk" && "bg-rose-400",
                  node.status === "opportunity" && "bg-(--gold)",
                  node.status === "done" && "bg-emerald-400",
                  node.status === "stale" && "bg-zinc-400",
                  node.status === "active" && "bg-cyan-400"
                )}
              />
              {node.status}
            </span>
          )}
          {(() => {
            const source = (node.metadata?.source as string) || "derived";
            return (
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.25 rounded text-[8px] font-semibold font-mono uppercase tracking-wider border",
                  source === "system_seed" && "bg-amber-500/10 border-amber-500/20 text-amber-400",
                  source === "derived" && "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
                  source === "database" && "bg-slate-500/10 border-slate-500/20 text-slate-400"
                )}
              >
                {source.replace("_", " ")}
              </span>
            );
          })()}
        </div>
        <button
          onClick={onClose}
          className="text-(--text-tertiary) hover:text-(--text-primary) transition-colors p-1"
          aria-label="Close panel"
        >
          <X size={14} />
        </button>
      </div>

      {/* Panel Scrollable Content */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
        <div>
          <h4 className="text-sm font-semibold uppercase tracking-wide leading-tight text-(--text-primary)">
            {node.label}
          </h4>
        </div>

        {/* Why this matters */}
        <div className="space-y-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--text-tertiary)">
            why this matters
          </span>
          <p className="text-xs text-(--text-secondary) leading-relaxed bg-black/30 p-2.5 rounded border border-(--border-default)/60">
            {whyMatters}
          </p>
        </div>

        {/* Connected leverage */}
        <div className="space-y-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--text-tertiary)">
            connected leverage
          </span>
          <p className="text-xs text-(--text-secondary) leading-relaxed">
            {leverageText}
          </p>
        </div>

        {/* Current Risk / Opportunity */}
        <div className="space-y-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--text-tertiary)">
            current status context
          </span>
          <p className="text-xs text-(--text-secondary) leading-relaxed">
            {riskOpportunity}
          </p>
        </div>

        {/* Next best move */}
        <div className="space-y-1">
          <span className="text-[9px] font-mono uppercase tracking-[0.14em] text-(--gold)">
            next best move
          </span>
          <p className="text-xs text-(--text-primary) font-medium leading-relaxed bg-(--gold)/2 border border-(--gold)/15 p-2.5 rounded">
            {nextMove}
          </p>
        </div>
      </div>

      {/* Panel Actions Footer */}
      <div className="pt-3 border-t border-(--border-default) flex flex-col gap-1.5">
        <button
          onClick={handleAskNick}
          className="w-full text-[10px] font-mono uppercase tracking-wider font-semibold rounded bg-(--gold) text-(--text-inverse) hover:bg-(--gold-dim) transition-colors min-h-[40px] flex items-center justify-center gap-1.5 active:scale-[0.98]"
        >
          <MessageSquare size={12} />
          ask nick about this
        </button>

        <div className="grid grid-cols-2 gap-1.5">
          <button
            onClick={() => onFocusNode(node.id)}
            className="text-[9px] font-mono uppercase tracking-wider rounded border border-(--border-default) bg-(--bg-elevated) text-(--text-secondary) hover:border-(--gold)/20 transition-colors min-h-[38px] flex items-center justify-center gap-1"
          >
            <Compass size={11} />
            focus graph
          </button>

          {node.href && (
            <button
              onClick={handleOpenPage}
              className="text-[9px] font-mono uppercase tracking-wider rounded border border-(--border-default) bg-(--bg-elevated) text-(--text-secondary) hover:border-(--gold)/20 transition-colors min-h-[38px] flex items-center justify-center gap-1"
            >
              open page
              <ArrowRight size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Fallback logic helpers to build deep information on nodes
function getFallbackWhy(node: BrainGraphNode): string {
  switch (node.type) {
    case "task":
      return "An active execution item required to unlock domain milestones and keep project momentum.";
    case "goal":
      return "Establishes a quantitative ceiling or milestone target for the domain, guiding daily habits.";
    case "mission":
      return "A project container designed to organize efforts, coordinate subtasks, and track completion progress.";
    case "memory":
      return "A self-model cognitive pattern extracted from telemetry and reflections to optimize future decisions.";
    case "journal":
      return "Raw capture dump containing qualitative context on mental state, drift triggers, and outcomes.";
    case "decision":
      return "Stored decision replay tracking stakes, reasoning, and lessons to audit decision quality.";
    case "person":
      return "Key relational node affecting social and business outcomes. Linked to commitments and communication cadence.";
    case "system":
      return "Deterministic infrastructure anchor regulating command routing, reasoning status, or visual feedback.";
    case "business":
      return "Enterprise lane focus directly contributing to cashflow, profit multipliers, and leverage.";
    default:
      return "Graph node representing a node in the self-model network.";
  }
}

function getFallbackNextMove(node: BrainGraphNode): string {
  switch (node.type) {
    case "task":
      return "Identify the next physical action and complete this item to prevent priority drift.";
    case "goal":
      return "Analyze outstanding tasks linked to this goal and progress the active milestones.";
    case "mission":
      return "Execute the critical path task and update weekly review outcomes.";
    case "memory":
      return "Challenge the validity of this memory context or link it to current active plans.";
    case "journal":
      return "Extract pending action loops and archive the triaged dump.";
    case "decision":
      return "Conduct a post-mortem review of actual vs predicted outcome.";
    case "person":
      return "Verify contact details and check if there are outstanding promises to follow up on.";
    case "system":
      return "Inspect active telemetry HUD logs to ensure model latencies and health are nominal.";
    case "business":
      return "Review conversion statistics and resolve the primary pipeline bottleneck.";
    default:
      return "Audit connection status.";
  }
}

function getRiskOpportunity(node: BrainGraphNode): string {
  if (node.status === "risk") {
    return "This node has high neglect costs, overdue constraints, or is flagged as an active risk.";
  }
  if (node.status === "opportunity") {
    return "High leverage index or high ROI score detected. Promotes compounding growth if accelerated.";
  }
  if (node.status === "done") {
    return "This item is resolved and completed, contributing positively to mastery progress.";
  }
  if (node.status === "stale") {
    return "Low activity or neglected update cycle. Subject to decay scoring.";
  }
  return "Stable operational state. Nominal progression rates.";
}

function getLeverage(node: BrainGraphNode): string {
  switch (node.type) {
    case "task":
      return "Tied directly to mission success metrics and target person commitments.";
    case "goal":
      return "Ladders upward to compound character stats and core empire lanes.";
    case "mission":
      return "Ladders into parent life goals, serving as the execution vehicle.";
    case "person":
      return "Greene law applications and power balance scores determine relationship leverage.";
    case "system":
      return "Affects overall NOUR OS telemetry and reasoning model speeds.";
    default:
      return "Connects related self-model memories and qualitative insights.";
  }
}
