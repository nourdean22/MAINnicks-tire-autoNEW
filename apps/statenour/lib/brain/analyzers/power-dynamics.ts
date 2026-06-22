/**
 * Power-dynamics analyzer · 2026-06-20
 *
 * Scores the operator's power position across all relationships.
 * Architecture mirrors mental-health.ts exactly: pure core
 * `computePowerDynamics()` (unit-tested, no IO) + thin IO wrapper
 * `analyzePowerDynamics()` (prisma reads → compute).
 */

import { prisma } from "@/lib/prisma";
import { daysAgo } from "@/lib/utils/datetime";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

// ── helpers ───────────────────────────────────────────────────────────
function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function round(n: number, d = 2): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

// ── types ─────────────────────────────────────────────────────────────
export interface PersonProfileInput {
  id: string;
  name: string;
  role: string | null;
  status: string | null;
  trustScore: number | null;
  powerBalance: number | null;
  interactionCount: number | null;
  metadata: Record<string, unknown> | null;
  lastInteractionAt: Date | null;
}

export interface LedgerEntryInput {
  personId: string;
  amount: number;
  source: string | null;
  createdAt: Date;
}

export interface PlayEntryInput {
  personId: string;
  kind: string;
  createdAt: Date;
}

export interface ContextualLawInput {
  personId: string;
  laws: { key: string; title: string; number?: number }[];
}

export interface PowerDynamicsAnalysis {
  window: { days: number };
  dataCompleteness: {
    profiles: number;
    withLedger: number;
    withPlays: number;
    sufficient: boolean;
    note: string;
  };
  leverage: {
    avgPowerBalance: number;
    strongestPositions: { name: string; balance: number; law: string | null }[];
    weakestPositions: { name: string; balance: number; law: string | null }[];
    dependencyRatio: number;
  };
  influence: {
    totalPlaysExecuted: number;
    playKinds: Record<string, number>;
    persuasionXp: number;
    strategyXp: number;
    networkingXp: number;
  };
  network: {
    totalProfiles: number;
    activeConnections: number;
    neglectedCount: number;
    mentorCount: number;
    rivalCount: number;
  };
  threats: {
    drainers: string[];
    rivals: string[];
    unstableAlliances: string[];
  };
  guidance: string[];
}

// ── pure core ─────────────────────────────────────────────────────────

/**
 * Pure scoring core. Takes already-fetched, normalized rows and returns
 * the full grounded power-dynamics analysis. No IO — unit-tested directly.
 */
export function computePowerDynamics(args: {
  profiles: PersonProfileInput[];
  ledgerEntries: LedgerEntryInput[];
  playEntries: PlayEntryInput[];
  contextualLaws: ContextualLawInput[];
  xpStats: { persuasion: number; strategy: number; networking: number };
  days: number;
}): PowerDynamicsAnalysis {
  const { profiles, ledgerEntries, playEntries, contextualLaws, xpStats, days } = args;

  const since = daysAgo(days);
  const profileCount = profiles.length;

  const lawMap = new Map<string, ContextualLawInput>();
  for (const cl of contextualLaws) lawMap.set(cl.personId, cl);

  const ledgerByPerson = new Map<string, LedgerEntryInput[]>();
  for (const l of ledgerEntries) {
    const arr = ledgerByPerson.get(l.personId) ?? [];
    arr.push(l);
    ledgerByPerson.set(l.personId, arr);
  }

  const playsByPerson = new Map<string, PlayEntryInput[]>();
  for (const p of playEntries) {
    const arr = playsByPerson.get(p.personId) ?? [];
    arr.push(p);
    playsByPerson.set(p.personId, arr);
  }

  const withLedger = profiles.filter((p) => ledgerByPerson.has(p.id)).length;
  const withPlays = profiles.filter((p) => playsByPerson.has(p.id)).length;
  const sufficient = profileCount >= 3;

  const dataCompleteness = {
    profiles: profileCount,
    withLedger,
    withPlays,
    sufficient,
    note: sufficient
      ? `Based on ${profileCount} profiles, ${withLedger} with ledger, ${withPlays} with plays over ~${days} days.`
      : `Only ${profileCount} profile${profileCount === 1 ? "" : "s"} — need ≥3 for a reliable power map.`,
  };

  if (profileCount === 0) {
    return {
      window: { days },
      dataCompleteness,
      leverage: { avgPowerBalance: 0, strongestPositions: [], weakestPositions: [], dependencyRatio: 0 },
      influence: { totalPlaysExecuted: 0, playKinds: {}, persuasionXp: xpStats.persuasion, strategyXp: xpStats.strategy, networkingXp: xpStats.networking },
      network: { totalProfiles: 0, activeConnections: 0, neglectedCount: 0, mentorCount: 0, rivalCount: 0 },
      threats: { drainers: [], rivals: [], unstableAlliances: [] },
      guidance: ["Add people to your network so Nick can map your power position."],
    };
  }

  // ── leverage ──
  const balances = profiles.filter((p) => p.powerBalance != null).map((p) => p.powerBalance as number);
  const avgPowerBalance = balances.length ? round(mean(balances)) : 0;

  const profilesWithBalance = profiles
    .filter((p) => p.powerBalance != null)
    .map((p) => ({
      name: p.name,
      balance: p.powerBalance as number,
      law: lawMap.get(p.id)?.laws[0]?.title ?? null,
    }));

  const sortedByBalance = [...profilesWithBalance].sort((a, b) => b.balance - a.balance);
  const strongestPositions = sortedByBalance.slice(0, 3);
  const weakestPositions = sortedByBalance.slice(-3).reverse();

  const dependencyCount = profiles.filter((p) => p.powerBalance != null && (p.powerBalance as number) < -0.2).length;
  const dependencyRatio = round(dependencyCount / profileCount);

  // ── influence ──
  const playKinds: Record<string, number> = {};
  for (const p of playEntries) playKinds[p.kind] = (playKinds[p.kind] ?? 0) + 1;

  // ── network ──
  const activeConnections = profiles.filter((p) => p.lastInteractionAt != null && p.lastInteractionAt >= since).length;
  const neglectedThreshold = daysAgo(30);
  const neglectedCount = profiles.filter((p) => p.lastInteractionAt == null || p.lastInteractionAt < neglectedThreshold).length;
  const mentorCount = profiles.filter((p) => p.role === "mentor" || p.role === "advisor").length;
  const rivalCount = profiles.filter((p) => p.role === "rival" || p.role === "enemy").length;

  // ── threats ──
  const drainers: string[] = [];
  for (const p of profiles) {
    const ledger = ledgerByPerson.get(p.id) ?? [];
    const recent = ledger.filter((l) => l.createdAt >= since);
    if (recent.length >= 3) {
      const net = recent.reduce((sum, l) => sum + l.amount, 0);
      if (net < -5) drainers.push(p.name);
    }
  }

  const rivals = profiles.filter((p) => p.role === "rival" || p.role === "enemy").map((p) => p.name);
  const unstableAlliances = profiles
    .filter((p) => (p.interactionCount ?? 0) >= 10 && p.trustScore != null && p.trustScore < 50)
    .map((p) => p.name);

  // ── guidance ──
  const guidance: string[] = [];
  if (dependencyRatio > 0.4) {
    guidance.push(`${Math.round(dependencyRatio * 100)}% of relationships show you dependent. Reduce outreach to non-reciprocaters.`);
  }
  if (neglectedCount > 0) {
    guidance.push(`${neglectedCount} connection${neglectedCount === 1 ? "" : "s"} not contacted in 30+ days. Re-engage your top 2 this week.`);
  }
  if (drainers.length > 0) {
    guidance.push(`${drainers.join(", ")} draining your ledger (net-negative ${days}d). Consider Law 10: avoid the unhappy and unlucky.`);
  }
  if (strongestPositions.length > 0 && strongestPositions[0].balance > 0.5) {
    guidance.push(`Strongest position: ${strongestPositions[0].name} (+${strongestPositions[0].balance}). Leverage to expand your network.`);
  }
  if (weakestPositions.length > 0 && weakestPositions[0].balance < -0.3) {
    guidance.push(`Weakest position: ${weakestPositions[0].name} (${weakestPositions[0].balance}). Law 1: never outshine the master.`);
  }
  if (mentorCount === 0) {
    guidance.push("No mentors in network. A mentor is the fastest leverage multiplier — build through service first.");
  }
  if (playEntries.length === 0) {
    guidance.push("No power plays in this window. Start with a reciprocity assessment on your top 3 contacts.");
  }
  if (guidance.length === 0) {
    guidance.push("Power position is balanced. Keep executing plays and monitoring your ledger.");
  }

  return {
    window: { days },
    dataCompleteness,
    leverage: { avgPowerBalance, strongestPositions, weakestPositions, dependencyRatio },
    influence: { totalPlaysExecuted: playEntries.length, playKinds, persuasionXp: xpStats.persuasion, strategyXp: xpStats.strategy, networkingXp: xpStats.networking },
    network: { totalProfiles: profileCount, activeConnections, neglectedCount, mentorCount, rivalCount },
    threats: { drainers, rivals, unstableAlliances },
    guidance,
  };
}

// ── IO wrapper ────────────────────────────────────────────────────────

export async function analyzePowerDynamics({
  days = 30,
}: { days?: number } = {}): Promise<PowerDynamicsAnalysis> {
  const since = daysAgo(days);

  const [profiles, ledgerEntries, playEntries, contextualLawRows, xpRows] =
    await Promise.all([
      prisma.personProfile.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, role: true, status: true, trustScore: true, powerBalance: true, interactionCount: true, metadata: true, lastInteraction: true },
      }).catch((): never[] => []),
      prisma.relationshipLedger.findMany({
        where: { createdAt: { gte: since } },
        select: { personId: true, amount: true, source: true, createdAt: true },
      }).catch((): never[] => []),
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.POWER_PLAY, deletedAt: null },
        select: { metadata: true, createdAt: true },
        take: 100,
      }).catch((): never[] => []),
      prisma.brainMemory.findMany({
        where: { category: BRAIN_CATEGORIES.GREENE_CONTEXTUAL_PICK, deletedAt: null },
        select: { key: true, metadata: true },
        take: 100,
      }).catch((): never[] => []),
      prisma.brainMemory.findMany({
        where: { category: { in: ["persuasion_xp", "strategy_xp", "networking_xp"] }, deletedAt: null },
        select: { category: true, content: true },
        take: 10,
      }).catch((): never[] => []),
    ]);

  const profileInputs: PersonProfileInput[] = (profiles as unknown[]).map((p) => {
    const r = p as Record<string, unknown>;
    return {
      id: String(r.id),
      name: String(r.name ?? "Unknown"),
      role: r.role ? String(r.role) : null,
      status: r.status ? String(r.status) : null,
      trustScore: r.trustScore != null ? Number(r.trustScore) : null,
      powerBalance: r.powerBalance != null ? Number(r.powerBalance) : null,
      interactionCount: r.interactionCount != null ? Number(r.interactionCount) : null,
      metadata: r.metadata as Record<string, unknown> | null,
      lastInteractionAt: r.lastInteraction ? new Date(r.lastInteraction as string) : null,
    };
  });

  const ledgerInputs: LedgerEntryInput[] = (ledgerEntries as unknown[]).map((l) => {
    const r = l as Record<string, unknown>;
    return { personId: String(r.personId), amount: Number(r.amount ?? 0), source: r.source ? String(r.source) : null, createdAt: new Date(r.createdAt as string) };
  });

  const playInputs: PlayEntryInput[] = (playEntries as unknown[]).map((p) => {
    const r = p as Record<string, unknown>;
    const meta = (r.metadata as Record<string, unknown> | null) ?? {};
    return { personId: String(meta.personId ?? ""), kind: String(meta.kind ?? "unknown"), createdAt: new Date(r.createdAt as string) };
  }).filter((p) => p.personId.length > 0);

  const contextualLawInputs: ContextualLawInput[] = (contextualLawRows as unknown[]).map((r) => {
    const row = r as Record<string, unknown>;
    const key = String(row.key ?? "");
    const personId = key.split(":")[0] ?? "";
    const meta = (row.metadata as Record<string, unknown> | null) ?? {};
    const laws = Array.isArray(meta.laws) ? (meta.laws as unknown[]).map((l) => {
      const law = l as Record<string, unknown>;
      return { key: String(law.key ?? ""), title: String(law.title ?? ""), number: law.number != null ? Number(law.number) : undefined };
    }) : [];
    return { personId, laws };
  }).filter((c) => c.personId.length > 0);

  const xpMap: Record<string, number> = {};
  for (const row of xpRows as unknown[]) {
    const r = row as Record<string, unknown>;
    const cat = String(r.category ?? "");
    const val = parseInt(String(r.content ?? "0"), 10);
    if (!isNaN(val)) xpMap[cat] = val;
  }

  return computePowerDynamics({
    profiles: profileInputs,
    ledgerEntries: ledgerInputs,
    playEntries: playInputs,
    contextualLaws: contextualLawInputs,
    xpStats: { persuasion: xpMap["persuasion_xp"] ?? 0, strategy: xpMap["strategy_xp"] ?? 0, networking: xpMap["networking_xp"] ?? 0 },
    days,
  });
}
