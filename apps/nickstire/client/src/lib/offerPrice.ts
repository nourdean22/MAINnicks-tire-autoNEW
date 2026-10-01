/**
 * Schema.org Offer price fields for a display price such as "From $160",
 * "$149–$299" or "Free estimate".
 *
 * Until 2026-10-01 FocusedServicePage stripped every non-digit from the display
 * string. The /warranties tier "12-Mo Parts / 90-Day Labor" reached Google as an
 * Offer priced $1290, and a range such as "$150–$350" would have become 150350.
 * Only dollar amounts are read now: a leading "$A–$B" range becomes a
 * PriceSpecification, otherwise the first amount is the price ("From $25
 * installed (select 12-inch; most $40-80)" is 25, not a 25-40 range), and a
 * display with no dollar amount yields no Offer at all.
 */
export type OfferPriceFields =
  | { price: string }
  | {
      priceSpecification: {
        "@type": "PriceSpecification";
        minPrice: string;
        maxPrice: string;
        priceCurrency: "USD";
      };
    };

const amount = (s: string) => s.replace(/,/g, "");

export function offerPriceFields(display: string): OfferPriceFields | null {
  const range = display.match(/^\s*(?:from\s+)?\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*[–—-]\s*\$?\s*(\d[\d,]*(?:\.\d{1,2})?)/i);
  if (range && amount(range[1]) !== amount(range[2])) {
    return {
      priceSpecification: {
        "@type": "PriceSpecification",
        minPrice: amount(range[1]),
        maxPrice: amount(range[2]),
        priceCurrency: "USD",
      },
    };
  }
  const first = display.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)/);
  return first ? { price: amount(first[1]) } : null;
}
