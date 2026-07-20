import { trpc } from "@/lib/trpc";
import {
  Trophy,
  Flame,
  Shield,
  Moon,
  Award,
  Clock,
  Sparkles,
  UserCheck,
  Zap,
} from "lucide-react";
import { Panel } from "../shared";

interface BadgeConfig {
  name: string;
  desc: string;
  icon: React.ReactNode;
  tiers: [number, number, number];
  unit: string;
  colorClass: string;
}

export function VoiceAchievements() {
  const { data: stats, isLoading } = trpc.vapi.achievements.useQuery(undefined, {
    staleTime: 60_000,
  });

  if (isLoading || !stats) {
    return (
      <div className="bg-card border border-border/40 p-4">
        <div className="text-[11px] font-bold tracking-[0.18em] uppercase text-foreground/30 animate-pulse">
          Loading achievements dashboard…
        </div>
      </div>
    );
  }

  // Gamification formulas
  const totalCalls = stats.totalCalls;
  const currentLevel = Math.floor(totalCalls / 20) + 1;
  const xpCurrent = totalCalls % 20;
  const xpTotal = 20;
  const levelProgressPct = (xpCurrent / xpTotal) * 100;

  // Calculate circular gauge offset (r=30, circumference=188.4)
  const radius = 30;
  const circ = 2 * Math.PI * radius;
  const dashOffset = circ - (levelProgressPct / 100) * circ;

  // Badge list config
  const badges: BadgeConfig[] = [
    {
      name: "Off-Counter Relief",
      desc: "Callers resolved by Nick directly, saving counter distraction.",
      icon: <UserCheck className="w-4 h-4" />,
      tiers: [5, 25, 100],
      unit: "resolved calls",
      colorClass: "from-blue-500/20 to-indigo-500/20 border-indigo-500/30 text-indigo-400",
    },
    {
      name: "Cleveland Road Protector",
      // 2026-07-20 · Copy corrected. This badge counts calls where Nick reached
      // a WRITE TOOL (convertedToLead / totalReachedTool) — it does NOT count
      // leads. Measured that day: 451 such calls, ZERO with a leadId, and the
      // leads table holds 2 rows, because tireInquiry deliberately stops
      // creating leads for ordinary inquiries (operator directive 2026-06-05).
      // The backing field was renamed in #970 but this operator-facing text
      // still said "leads captured", which is the part the operator reads.
      desc: "High-intent callers where Nick reached a capture tool (tire size, inquiry, booking).",
      icon: <Shield className="w-4 h-4" />,
      tiers: [3, 15, 50],
      unit: "calls engaged",
      colorClass: "from-emerald-500/20 to-teal-500/20 border-teal-500/30 text-emerald-400",
    },
    {
      name: "Night Watchman",
      desc: "After-hours and Sunday calls handled while counter is closed.",
      icon: <Moon className="w-4 h-4" />,
      tiers: [5, 20, 80],
      unit: "after-hours calls",
      colorClass: "from-purple-500/20 to-pink-500/20 border-pink-500/30 text-pink-400",
    },
    {
      name: "Silver Tongue",
      desc: "Perfect customer sentiment score evaluation (85+ rating).",
      icon: <Award className="w-4 h-4" />,
      tiers: [2, 10, 40],
      unit: "exemplary calls",
      colorClass: "from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-400",
    },
    {
      name: "Hours Saved",
      desc: "Cumulative conversational airtime taken off human lines.",
      icon: <Clock className="w-4 h-4" />,
      tiers: [10, 60, 300], // in minutes
      unit: "minutes talk time",
      colorClass: "from-cyan-500/20 to-blue-500/20 border-cyan-500/30 text-cyan-400",
    },
  ];

  function getBadgeLevel(val: number, tiers: [number, number, number]) {
    if (val < tiers[0]) {
      return {
        level: 0,
        label: "Locked",
        nextTarget: tiers[0],
        progressPct: (val / tiers[0]) * 100,
        current: val,
      };
    }
    if (val < tiers[1]) {
      return {
        level: 1,
        label: "Bronze (Level 1)",
        nextTarget: tiers[1],
        progressPct: ((val - tiers[0]) / (tiers[1] - tiers[0])) * 100,
        current: val,
      };
    }
    if (val < tiers[2]) {
      return {
        level: 2,
        label: "Silver (Level 2)",
        nextTarget: tiers[2],
        progressPct: ((val - tiers[1]) / (tiers[2] - tiers[1])) * 100,
        current: val,
      };
    }
    return {
      level: 3,
      label: "Gold (Level 3 - MAX)",
      nextTarget: null,
      progressPct: 100,
      current: val,
    };
  }

  // Get current values mapped to badges
  const badgeValues = [
    stats.totalResolved, // Off-Counter Relief
    // Renamed 2026-07-20: this counts calls that REACHED A WRITE TOOL, not
    // leads created. See the doc comment on totalReachedTool in routers/vapi.ts.
    stats.totalReachedTool, // Cleveland Road Protector
    stats.totalAfterHours, // Night Watchman
    stats.totalExemplary, // Silver Tongue
    Math.round(stats.totalDuration / 60), // Hours Saved (in minutes)
  ];

  return (
    <Panel
      title="Nick AI Achievements & Performance"
      subtitle="Gamified shop-saving achievements and operational level tracking"
      icon={<Trophy className="w-4 h-4 text-amber-400" />}
    >
      <div className="space-y-5">
        {/* Core level status row */}
        <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-foreground/[0.02] border border-border/20">
          {/* Circular level gauge */}
          <div className="relative flex items-center justify-center shrink-0">
            <svg className="w-20 h-20 transform -rotate-90">
              <circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-border/40 fill-none"
                strokeWidth="6"
              />
              <circle
                cx="40"
                cy="40"
                r={radius}
                className="stroke-amber-400 fill-none transition-all duration-500"
                strokeWidth="6"
                strokeDasharray={circ}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-[10px] tracking-widest text-foreground/40 font-bold uppercase">LVL</span>
              <span className="text-xl font-black text-foreground -mt-1 leading-none">{currentLevel}</span>
            </div>
          </div>

          {/* Level details & description */}
          <div className="flex-1 w-full space-y-2 text-center sm:text-left">
            <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
              <div>
                <h4 className="font-extrabold text-sm text-foreground uppercase tracking-wide flex items-center justify-center sm:justify-start gap-1">
                  Nick AI Receptionist <Sparkles className="w-3.5 h-3.5 text-amber-400 fill-amber-400/20" />
                </h4>
                <p className="text-foreground/50 text-[11px] mt-0.5">
                  XP increments on every inbound/outbound call handled. Level up every 20 calls.
                </p>
              </div>
              <span className="text-xs font-mono text-foreground/60 tabular-nums">
                {xpCurrent} / {xpTotal} XP
              </span>
            </div>

            {/* XP progress bar */}
            <div className="w-full bg-border/30 h-2 rounded overflow-hidden">
              <div
                className="bg-gradient-to-r from-amber-500 to-amber-400 h-full rounded transition-all duration-500"
                style={{ width: `${levelProgressPct}%` }}
              />
            </div>
          </div>
        </div>

        {/* Performance streak flame card */}
        {stats.streak > 0 && (
          <div className="flex items-center gap-3.5 px-4 py-3 bg-amber-500/[0.04] border border-amber-500/20 rounded-sm">
            <div className="p-2 bg-amber-500/10 rounded-full text-amber-400 animate-pulse">
              <Flame className="w-5 h-5 fill-amber-400/20" />
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-bold tracking-widest uppercase text-amber-400/80">Active Hot Streak</span>
              <p className="text-sm font-semibold text-foreground/90 mt-0.5">
                Nick is on a <span className="text-amber-400 font-extrabold">{stats.streak}-call</span> perfect streak! Sentiment scores holding above 70.
              </p>
            </div>
          </div>
        )}

        {/* Achievements Milestone grid */}
        <div className="space-y-2.5">
          <p className="text-[10px] font-bold tracking-[0.15em] uppercase text-foreground/50">Operational Milestones</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            {badges.map((b, idx) => {
              const val = badgeValues[idx];
              const badge = getBadgeLevel(val, b.tiers);
              const isMax = badge.nextTarget === null;
              
              // Badge icon container styles based on unlocked status
              const borderStyles = badge.level > 0 
                ? "border-primary/40 bg-primary/5 hover:bg-primary/[0.08]" 
                : "border-border/30 bg-card/50 opacity-60";
              const levelBadgeText = badge.level === 3 
                ? "GOLD" 
                : badge.level === 2 
                  ? "SILVER" 
                  : badge.level === 1 
                    ? "BRONZE" 
                    : "LOCKED";
              
              return (
                <div 
                  key={b.name} 
                  className={`flex flex-col justify-between border p-3.5 rounded-sm transition-all duration-300 group ${borderStyles}`}
                >
                  <div className="space-y-2">
                    {/* Header: Icon + Level tag */}
                    <div className="flex items-center justify-between">
                      <div className={`p-1.5 rounded-md border ${b.colorClass}`}>
                        {b.icon}
                      </div>
                      <span className={`text-[9px] font-extrabold tracking-widest px-1.5 py-0.5 rounded-sm ${
                        badge.level === 3 ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                        badge.level === 2 ? "bg-slate-500/20 text-slate-300 border border-slate-500/30" :
                        badge.level === 1 ? "bg-amber-700/20 text-amber-400 border border-amber-700/30" :
                        "bg-foreground/5 text-foreground/40 border border-border/20"
                      }`}>
                        {levelBadgeText}
                      </span>
                    </div>

                    {/* Content */}
                    <div>
                      <h5 className="font-extrabold text-[13px] text-foreground tracking-wide leading-tight group-hover:text-primary transition-colors">
                        {b.name}
                      </h5>
                      <p className="text-foreground/50 text-[10px] leading-tight mt-1 min-h-[40px]">
                        {b.desc}
                      </p>
                    </div>
                  </div>

                  {/* Progress & values */}
                  <div className="space-y-1.5 mt-3 pt-3 border-t border-border/15">
                    <div className="flex justify-between items-baseline text-[10px]">
                      <span className="font-mono text-foreground/75 tabular-nums">
                        {badge.current} <span className="text-foreground/40 text-[9px]">{b.unit.split(" ")[0]}</span>
                      </span>
                      {!isMax && (
                        <span className="text-foreground/40 font-mono">
                          Target: {badge.nextTarget}
                        </span>
                      )}
                    </div>

                    {/* Small progress bar */}
                    <div className="w-full bg-border/25 h-1.5 rounded overflow-hidden">
                      <div 
                        className={`h-full rounded transition-all duration-500 ${
                          badge.level === 3 ? "bg-amber-400" :
                          badge.level === 2 ? "bg-slate-400" :
                          badge.level === 1 ? "bg-amber-600" :
                          "bg-foreground/20"
                        }`}
                        style={{ width: `${badge.progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
