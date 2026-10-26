import { eq } from "drizzle-orm";
import { z } from "zod";
import { shopSettings } from "../../drizzle/schema";
import { db, requireDb } from "./db-helper";
import { logSafeErrorMessage } from "./dbErrors";

/** The one bound on the markup percent: the admin's input and the stored-value read both use it. */
export const markupPercentSchema = z.number().min(0).max(300);

/** The shop's tire markup in percent (shop_settings.tireMarkup), 100 when unset. Shared by publicSearch, placeOrder and tireQuote. */
export async function getTireMarkup(): Promise<number> {
  const d = await db();
  if (!d) return 100; // Default 100% markup
  const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
  return result.length > 0 ? parseFloat(result[0].value) : 100;
}

/** shop_settings.updatedBy is varchar(100): a longer value is rejected under STRICT_TRANS_TABLES, not cut. */
const BY_MAX = 100;

export type TireMarkupRead =
  | { available: true; percent: number | null; updatedAt: string | null; updatedBy: string | null; note: string | null }
  | { available: false; reason: "error"; message: string };

/**
 * The saved markup as the admin sees it: the percent with when and by whom it was set. A missing row
 * is percent null (never the 100 pricing default); a value outside 0..300 or not a number is percent
 * null with a note, but still names who and when. Pricing keeps reading getTireMarkup unchanged.
 */
export async function readTireMarkupSetting(): Promise<TireMarkupRead> {
  try {
    const d = await requireDb();
    const [row] = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
    if (!row) return { available: true, percent: null, updatedAt: null, updatedBy: null, note: null };
    // Same number the pricing path parses (parseFloat), then held to the one bound.
    const parsed = markupPercentSchema.safeParse(parseFloat(row.value));
    return {
      available: true,
      percent: parsed.success ? parsed.data : null,
      updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
      updatedBy: row.updatedBy,
      note: parsed.success ? null : "stored value unreadable",
    };
  } catch (err) {
    return { available: false, reason: "error", message: `The markup could not be read: ${logSafeErrorMessage(err)}` };
  }
}

/** Saves the markup as `by` (one upsert on the unique key) and returns the row as it now reads. A failed write throws. */
export async function saveTireMarkup(percent: number, by: string): Promise<TireMarkupRead> {
  const d = await requireDb();
  const updatedBy = by.slice(0, BY_MAX);
  await d
    .insert(shopSettings)
    .values({ key: "tireMarkup", value: percent.toString(), category: "pricing", label: "Tire Markup %", updatedBy })
    .onDuplicateKeyUpdate({ set: { value: percent.toString(), updatedBy } });
  return readTireMarkupSetting();
}
