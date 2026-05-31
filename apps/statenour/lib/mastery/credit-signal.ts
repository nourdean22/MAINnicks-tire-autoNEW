/**
 * creditFromSignal — the single write-time door for mastery XP from ANY
 * life-signal · Ambition/Mastery · 2026-05-31.
 *
 * `SIGNAL_XP` (leveling.ts) defines task/habit/decision/journal/email/chat,
 * but historically only `task` fired write-time + a nightly backfill swept
 * chat/captures/decisions. This is the door every surface calls the MOMENT
 * something real happens — so the character sheet is true AND immediate, and
 * the dopamine loop (do the thing → the bar moves → you feel it) actually
 * compounds. Wiring, not invention: the attributors + creditStatXp already
 * exist; this just routes them.
 *
 * Routing:
 *   · habit → attributeHabit (rule-based, free, instant) → SIGNAL_XP.habit
 *   · journal/chat/email/decision/task → attributeText (cheap AI classify) →
 *     the attributor's own xp (0–3), exactly as backfillStatXp already does.
 *
 * Idempotent per sourceKey (creditStatXp dedupes) — so a live credit and the
 * backfill cron can't double-count as long as they share the sourceKey
 * convention (journal:<id> · decision:<id> · chat:<id> · capture:<id> · …).
 *
 * The NOISE FLOOR is preserved: attributeText returns null for no-skill
 * signals (logistics, small talk) → no credit. XP only means something if not
 * everything gives it. Never throws (fire-and-forget safe).
 */
import "server-only";

import { creditStatXp } from "./credit";
import { attributeHabit, attributeText } from "./attribution";
import { SIGNAL_XP, type MasterySignal } from "./leveling";

export interface SignalEvidence {
  /** Stable per-source id for dedup, e.g. `journal:<reflectionId>`. */
  sourceKey: string;
  /** Unstructured text (journal/chat/email/decision/task) → AI attribution. */
  text?: string;
  /** Habit key (the `habit` signal) → rule-based attribution. */
  habitKey?: string;
}

const MIN_TEXT_LEN = 12;

/**
 * Credit XP from one life-signal at write-time. Returns true when a NEW
 * credit landed (idempotent re-fires + noise + missing inputs → false).
 * Never throws.
 */
export async function creditFromSignal(
  signal: MasterySignal,
  ev: SignalEvidence,
): Promise<boolean> {
  try {
    if (!ev?.sourceKey) return false;

    // Structured signal · rule-based, free, instant.
    if (signal === "habit") {
      const stat = attributeHabit(ev.habitKey ?? "");
      if (!stat) return false;
      return await creditStatXp({
        stat,
        xp: SIGNAL_XP.habit,
        signal,
        evidence: `habit · ${ev.habitKey ?? ""}`.slice(0, 120),
        sourceKey: ev.sourceKey,
      });
    }

    // Unstructured signal · AI classifies into ONE stat (+ its own xp 0–3).
    // null = no real skill exercised → no credit (the floor). Mirrors
    // backfillStatXp's path so the two never disagree.
    const text = (ev.text ?? "").trim();
    if (text.length < MIN_TEXT_LEN) return false;
    const attr = await attributeText(text, signal);
    if (!attr) return false;
    return await creditStatXp({
      stat: attr.stat,
      xp: attr.xp,
      signal,
      evidence: attr.evidence,
      sourceKey: ev.sourceKey,
    });
  } catch {
    return false;
  }
}
