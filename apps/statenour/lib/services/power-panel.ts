/**
 * Power panel settings service (W11.3) — single consolidated surface for
 * every kill switch and operational knob.
 *
 * Storage: BrainMemory with category="power_panel", key=<setting>.
 * Using BrainMemory avoids a dedicated settings table — the same
 * retention + backup story already applies, row shape is tiny.
 *
 * Settings are sparse: absence = default (permissive). The consumer
 * applies a sane default when no row exists.
 */

import { prisma } from "@/lib/prisma";

const CATEGORY = "power_panel";

export type ProviderPin = "venice" | "openai" | "anthropic" | "gemini" | "auto";
export type QuietLevel = "off" | "nudges" | "all";

export interface PowerSettings {
  /** When true, suspend all nudges (notification-sender cron) */
  quietMode: QuietLevel;
  /** Pin AI calls to a provider; "auto" uses the fallback chain */
  providerPin: ProviderPin;
  /** Refuse AI calls estimated to cost > strictCostCapCents */
  strictMode: boolean;
  /** Max daily AI cost in cents (0 = disabled) */
  dailyCostCapCents: number;
  /** When true, all scheduled crons are paused */
  pauseAllCrons: boolean;
  /** When true, shadow mode runs next-gen prompt/model in shadow */
  shadowMode: boolean;
  /** ISO timestamp when last changed, for audit */
  updatedAt: string;
  /** Who made the change (optional; currently "nour") */
  updatedBy: string;
}

const DEFAULTS: PowerSettings = {
  quietMode: "off",
  providerPin: "auto",
  strictMode: false,
  dailyCostCapCents: 0,
  pauseAllCrons: false,
  shadowMode: false,
  updatedAt: new Date(0).toISOString(),
  updatedBy: "default",
};

/** Read all settings. Rows are sparse — missing keys get defaults. */
export async function getPowerSettings(): Promise<PowerSettings> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY },
    select: { key: true, content: true, updatedAt: true },
  });
  const out: PowerSettings = { ...DEFAULTS };
  let newest = new Date(0);
  for (const r of rows) {
    try {
      const parsed = JSON.parse(r.content) as { value: unknown };
      switch (r.key) {
        case "quietMode":
          if (parsed.value === "off" || parsed.value === "nudges" || parsed.value === "all") {
            out.quietMode = parsed.value;
          }
          break;
        case "providerPin":
          if (["venice", "openai", "anthropic", "gemini", "auto"].includes(parsed.value as string)) {
            out.providerPin = parsed.value as ProviderPin;
          }
          break;
        case "strictMode":
          out.strictMode = Boolean(parsed.value);
          break;
        case "dailyCostCapCents":
          if (typeof parsed.value === "number" && parsed.value >= 0) {
            out.dailyCostCapCents = parsed.value;
          }
          break;
        case "pauseAllCrons":
          out.pauseAllCrons = Boolean(parsed.value);
          break;
        case "shadowMode":
          out.shadowMode = Boolean(parsed.value);
          break;
      }
      if (r.updatedAt > newest) newest = r.updatedAt;
    } catch {
      // ignore malformed rows
    }
  }
  if (newest.getTime() > 0) out.updatedAt = newest.toISOString();
  return out;
}

/** Write a single setting. Returns the new value. */
export async function setPowerSetting<K extends keyof PowerSettings>(
  key: K,
  value: PowerSettings[K],
  note?: string,
): Promise<void> {
  const content = JSON.stringify({
    value,
    updatedAt: new Date().toISOString(),
    note: note ?? null,
  });
  await prisma.brainMemory.upsert({
    where: { category_key: { category: CATEGORY, key: String(key) } },
    create: {
      category: CATEGORY,
      key: String(key),
      content,
      confidence: 1,
      source: "power_panel",
    },
    update: { content, lastSeen: new Date(), seenCount: { increment: 1 } },
  });
}

/** Check if AI calls are currently permitted given the settings + today's burn.
 *  `bypassStrict` is for non-discretionary calls (health probes, repair
 *  crons) that must run even while strict mode is pausing chat. */
export async function checkAiBudget(
  estimateCents: number = 0,
  opts: { bypassStrict?: boolean } = {},
): Promise<{ allowed: true } | { allowed: false; reason: string }> {
  const bypassStrict = opts.bypassStrict === true;
  const s = await getPowerSettings();
  // 2026-07-16 audit · strict mode was DECORATIVE on the hot path. The
  // guard read `estimateCents > 10`, but the only live caller — the chat
  // gate — passes `checkAiBudget(2)`, and 2 > 10 is never true. The
  // operator could flip "strict mode" in the power panel and every chat
  // turn kept spending, silently. Strict mode now means what the switch
  // says: no discretionary AI calls until it's turned off. Callers that
  // must run regardless (health probes, cron repair) can pass
  // `bypassStrict` explicitly rather than relying on a threshold that
  // silently exempted everything.
  if (s.strictMode && !bypassStrict) {
    return { allowed: false, reason: "strict mode on · discretionary AI calls paused" };
  }
  if (s.dailyCostCapCents > 0) {
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const agg = await prisma.aiGeneration.aggregate({
      where: { createdAt: { gte: todayStart } },
      _sum: { costCents: true },
    });
    const spent = agg._sum.costCents ?? 0;
    if (spent + estimateCents > s.dailyCostCapCents) {
      return {
        allowed: false,
        reason: `daily cost cap hit · ${spent}¢ spent + ${estimateCents}¢ estimate > ${s.dailyCostCapCents}¢ cap`,
      };
    }
  }
  return { allowed: true };
}
