/**
 * Website & Local checklist marks (contract localGrowth.checklist v1).
 *
 * The Entity / Brand and GBP Q&A lists have items only a person can verify on the platform (no code
 * can log in to them), so the admin marks one done, on a date, with an optional note. One mark is
 * one shop_settings row: key `local_checklist:<slug>`, value JSON { checkedAt, note, by }. No DDL.
 * Unchecking DELETES the row, so an unchecked item never carries a stale date.
 *
 * The router validates the slug (`[a-z0-9-]{1,60}`, so key <= 76 chars) and the note (<= 300): TiDB
 * runs STRICT_TRANS_TABLES, which rejects an over-width write and loses the row.
 */
import { asc, eq, like } from "drizzle-orm";
import { shopSettings } from "../../drizzle/schema";
import { dbTyped } from "../lib/db-helper";
import { logSafeErrorMessage } from "../lib/dbErrors";

const PREFIX = "local_checklist:";
const MAX_ITEMS = 200;
/** shop_settings.updatedBy is varchar(100): a longer value would be rejected, not cut. */
const BY_MAX = 100;

type LocalChecklistMark = { checkedAt: string; note: string | null; by: string };
type LocalChecklistRead =
  | { ok: true; items: Record<string, LocalChecklistMark>; skipped: number }
  | { ok: false; reason: "error"; message: string };
type LocalChecklistWrite =
  | { ok: true; slug: string; checkedAt: string | null }
  | { ok: false; reason: "error"; message: string };

/** A stored value back into a mark, or null when it is not one (never throws). */
function parseMark(raw: string): LocalChecklistMark | null {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const { checkedAt, note, by } = v as Record<string, unknown>;
    if (typeof checkedAt !== "string" || Number.isNaN(Date.parse(checkedAt))) return null;
    if (note !== null && typeof note !== "string") return null;
    if (typeof by !== "string") return null;
    return { checkedAt, note, by };
  } catch {
    return null;
  }
}

export async function getLocalChecklist(): Promise<LocalChecklistRead> {
  const d = await dbTyped();
  if (!d) return { ok: false, reason: "error", message: "Database unavailable: the checklist could not be read." };
  try {
    const rows = await d
      .select({ key: shopSettings.key, value: shopSettings.value })
      .from(shopSettings)
      .where(like(shopSettings.key, `${PREFIX}%`))
      .orderBy(asc(shopSettings.key))
      .limit(MAX_ITEMS);
    const items: Record<string, LocalChecklistMark> = {};
    let skipped = 0;
    for (const row of rows) {
      // LIKE's `_` matches any one character, so re-check the exact prefix.
      if (!row.key.startsWith(PREFIX)) continue;
      const mark = parseMark(row.value);
      if (mark) items[row.key.slice(PREFIX.length)] = mark;
      else skipped += 1;
    }
    return { ok: true, items, skipped };
  } catch (err) {
    return { ok: false, reason: "error", message: `The checklist could not be read: ${logSafeErrorMessage(err)}` };
  }
}

export async function setLocalChecklistItem(input: {
  slug: string;
  checked: boolean;
  note?: string | null;
  by: string;
}): Promise<LocalChecklistWrite> {
  const d = await dbTyped();
  if (!d) return { ok: false, reason: "error", message: "Database unavailable: the mark was not saved." };
  const key = `${PREFIX}${input.slug}`;
  try {
    if (!input.checked) {
      await d.delete(shopSettings).where(eq(shopSettings.key, key));
      return { ok: true, slug: input.slug, checkedAt: null };
    }
    const by = input.by.slice(0, BY_MAX);
    const checkedAt = new Date().toISOString();
    const value = JSON.stringify({ checkedAt, note: input.note?.trim() || null, by } satisfies LocalChecklistMark);
    await d
      .insert(shopSettings)
      .values({ key, value, label: `Local checklist: ${input.slug}`, category: "general", updatedBy: by })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: by } });
    return { ok: true, slug: input.slug, checkedAt };
  } catch (err) {
    return { ok: false, reason: "error", message: `The mark was not saved: ${logSafeErrorMessage(err)}` };
  }
}
