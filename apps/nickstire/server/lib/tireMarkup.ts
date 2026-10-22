import { eq } from "drizzle-orm";
import { shopSettings } from "../../drizzle/schema";
import { db } from "./db-helper";

/** The shop's tire markup in percent (shop_settings.tireMarkup), 100 when unset. Shared by publicSearch, placeOrder and tireQuote. */
export async function getTireMarkup(): Promise<number> {
  const d = await db();
  if (!d) return 100; // Default 100% markup
  const result = await d.select().from(shopSettings).where(eq(shopSettings.key, "tireMarkup")).limit(1);
  return result.length > 0 ? parseFloat(result[0].value) : 100;
}
