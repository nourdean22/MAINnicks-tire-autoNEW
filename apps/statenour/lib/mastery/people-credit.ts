/**
 * People → mastery XP · 2026-06-01 · statenour/people-overhaul
 *
 * Wires the /people (Power Atlas) surface into the leveling engine.
 * Until now people-work earned ZERO XP even though the INFLUENCE &
 * PEOPLE branch (networking · relationships · persuasion · seduction ·
 * strategy) is exactly what it should level.
 *
 * Operator's rule (2026-06-01): credit REAL REPS, not mere cataloguing.
 *   · ledger DEPOSIT (amount > 0)  → networking | relationships (by role)
 *   · power-PLAY executed          → strategy | persuasion | seduction | networking (by kind)
 *   · a deposit that REPAIRS a neglected (>14d) bond → small relationships bonus
 * What earns nothing: adding a name, a withdrawal, a blow-up / status
 * downgrade (a loss is not a win).
 *
 * Reuses the idempotent `creditStatXp` seam (BrainMemory
 * mastery_xp_event) — NOT goal-stats.ts (the task-side, owned by a
 * concurrent session). The sourceKey encodes the person
 * (`person:<personId>:<kind>:<eventId>`) so the UI can sum what a single
 * relationship has earned with one prefix query, and re-crediting the
 * same event is a no-op.
 */
import { prisma } from "@/lib/prisma";
import { creditStatXp, MASTERY_XP_CATEGORY } from "./credit";
import { getSetting } from "@/lib/services/settings";

/** Default XP weights — the single source of the numbers; operator
 *  overrides (stored under PEOPLE_XP_SETTING_KEY) layer on top. */
export const PEOPLE_XP_DEFAULTS = {
  /** floor XP for any positive deposit */
  depositBase: 0.5,
  /** extra XP per +1 of ledger amount */
  depositPerAmount: 0.03,
  /** ceiling for a single deposit */
  depositMax: 1.5,
  /** bonus relationships XP when a deposit reconnects a neglected bond */
  reconnectBonus: 0.4,
  /** XP for one executed power-play (a deliberate strategic rep) */
  play: 1.0,
} as const;

/** Mutable numeric shape. `-readonly` strips the modifier the homomorphic
 *  mapped type would otherwise inherit from the `as const` defaults. */
export type PeopleXpConfig = {
  -readonly [K in keyof typeof PEOPLE_XP_DEFAULTS]: number;
};

/** UserPreference key (category "mastery") holding the operator overrides. */
export const PEOPLE_XP_SETTING_KEY = "people_credit.weights";

/** A bond untouched this long, then deposited on, counts as a repair. */
const NEGLECT_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the active XP weights: hardcoded defaults with any operator
 * override merged on top. Only finite, non-negative numeric overrides
 * win — a malformed/partial setting can never zero out the engine by
 * accident. Never throws (falls back to defaults).
 */
export async function resolvePeopleXp(): Promise<PeopleXpConfig> {
  const merged: PeopleXpConfig = { ...PEOPLE_XP_DEFAULTS };
  type Override = Partial<Record<keyof PeopleXpConfig, unknown>>;
  const override = await getSetting<Override>(PEOPLE_XP_SETTING_KEY, {}).catch(
    (): Override => ({}),
  );
  for (const k of Object.keys(merged) as (keyof PeopleXpConfig)[]) {
    const v = override[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) merged[k] = v;
  }
  return merged;
}

/**
 * Personal / intimate roles level Relationships & Family; professional,
 * strategic, and adversarial roles level Networking & Alliances (the
 * Greene power-network stat). Unknown / null → networking.
 */
const RELATIONSHIP_ROLES = new Set([
  "family",
  "friend",
  "close_friend",
  "romantic",
  "ex_romantic",
  "ex_friend",
  "acquaintance",
]);

export function statForRole(role: string | null | undefined): "relationships" | "networking" {
  return role && RELATIONSHIP_ROLES.has(role) ? "relationships" : "networking";
}

/** Which stat a power-play kind develops. */
const PLAY_STAT: Record<string, string> = {
  arc_plan: "strategy", // planning the relationship's trajectory
  message_draft: "persuasion", // crafting words that move someone
  scarcity_play: "seduction", // allure / pull-back (Greene seduction)
  reciprocity_assess: "networking", // weighing the give/take of an alliance
};

/**
 * Credit a positive ledger deposit. No-op for amount <= 0. Idempotent
 * per ledger row. Fire-and-forget safe — never throws.
 *
 * @param priorLastInteraction the person's lastInteraction BEFORE this
 *   deposit bumped it — used to detect a neglect-repair. Omit to skip
 *   the reconnect bonus.
 */
export async function creditLedgerDeposit(args: {
  ledgerId: string;
  personId: string;
  amount: number;
  note: string;
  role?: string | null;
  priorLastInteraction?: Date | null;
}): Promise<void> {
  try {
    if (args.amount <= 0) return;
    const cfg = await resolvePeopleXp();
    const stat = statForRole(args.role);
    const xp = Math.min(
      cfg.depositMax,
      Math.round((cfg.depositBase + args.amount * cfg.depositPerAmount) * 10) / 10,
    );
    await creditStatXp({
      stat,
      xp,
      signal: "decision",
      evidence: `Relationship deposit (+${args.amount}): ${args.note}`.slice(0, 120),
      sourceKey: `person:${args.personId}:ledger:${args.ledgerId}`,
    });

    // Neglect-repair bonus: a deposit on a bond untouched > NEGLECT_DAYS
    // is the exact behavior the watchlist nags about — reward it.
    const prior = args.priorLastInteraction;
    if (prior && Date.now() - new Date(prior).getTime() > NEGLECT_DAYS * DAY_MS) {
      await creditStatXp({
        stat: "relationships",
        xp: cfg.reconnectBonus,
        signal: "decision",
        evidence: `Reconnected after neglect: ${args.note}`.slice(0, 120),
        sourceKey: `person:${args.personId}:reconnect:${args.ledgerId}`,
      });
    }
  } catch {
    /* fire-and-forget: never break the mutation that called us */
  }
}

/**
 * Credit an executed power-play. Idempotent per play row. Fire-and-forget.
 */
export async function creditPowerPlay(args: {
  playId: string;
  personId: string;
  kind: string;
}): Promise<void> {
  try {
    const cfg = await resolvePeopleXp();
    const stat = PLAY_STAT[args.kind] ?? "strategy";
    await creditStatXp({
      stat,
      xp: cfg.play,
      signal: "decision",
      evidence: `Power-play executed: ${args.kind}`.slice(0, 120),
      sourceKey: `person:${args.personId}:play:${args.playId}`,
    });
  } catch {
    /* fire-and-forget */
  }
}

export interface PersonXpSummary {
  total: number;
  count: number;
  byStat: Record<string, number>;
}

/**
 * Sum the mastery XP a single relationship has earned (deposits + plays
 * + reconnect bonuses), for the per-person "+XP" chip on /people.
 * Reads the mastery_xp_event log by the `person:<id>:` sourceKey prefix.
 */
export async function peopleXpForPerson(personId: string): Promise<PersonXpSummary> {
  const rows = await prisma.brainMemory
    .findMany({
      where: {
        category: MASTERY_XP_CATEGORY,
        key: { startsWith: `person:${personId}:` },
      },
      select: { metadata: true },
    })
    .catch((): { metadata: unknown }[] => []);

  const byStat: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const m = (r.metadata ?? {}) as { stat?: string; xp?: number };
    if (typeof m.stat === "string" && typeof m.xp === "number") {
      byStat[m.stat] = (byStat[m.stat] ?? 0) + m.xp;
      total += m.xp;
    }
  }
  return { total: Math.round(total * 10) / 10, count: rows.length, byStat };
}
