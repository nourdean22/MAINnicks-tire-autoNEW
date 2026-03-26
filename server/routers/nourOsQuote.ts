/**
 * NOUR-OS Quote Router — bridges nickstire.org to autonicks.com public APIs
 *
 * Fetches real labor data + tire inventory from statenour-os,
 * creates quotes via the statenour-os API for instant customer quotes.
 */
import { publicProcedure, router } from "../_core/trpc";
import { z } from "zod";

const NOUR_OS_API = process.env.NOUR_OS_API_URL ?? "https://autonicks.com";

async function fetchNourOS(path: string, init?: RequestInit) {
  const res = await fetch(`${NOUR_OS_API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`NOUR-OS API error (${res.status}): ${text}`);
  }
  return res.json();
}

export const nourOsQuoteRouter = router({
  /**
   * Search tires by size — returns retail pricing only (no wholesale).
   */
  searchTires: publicProcedure
    .input(
      z.object({
        size: z.string().min(3).max(30),
        brand: z.string().optional(),
        sort: z.enum(["price-asc", "price-desc", "brand"]).optional(),
        page: z.number().int().min(1).default(1),
      })
    )
    .query(async ({ input }) => {
      const params = new URLSearchParams({ size: input.size, page: String(input.page) });
      if (input.brand) params.set("brand", input.brand);
      if (input.sort) params.set("sort", input.sort);
      return fetchNourOS(`/api/tires/search?${params.toString()}`);
    }),

  /**
   * Get labor estimate for selected operations on a vehicle.
   */
  laborEstimate: publicProcedure
    .input(
      z.object({
        year: z.string().min(4).max(4),
        make: z.string().min(1).max(50),
        model: z.string().min(1).max(50),
        ops: z.string().min(1), // comma-separated operation names
      })
    )
    .query(async ({ input }) => {
      const params = new URLSearchParams({
        year: input.year,
        make: input.make,
        model: input.model,
        ops: input.ops,
      });
      return fetchNourOS(`/api/labor/estimate?${params.toString()}`);
    }),

  /**
   * List all available labor operations grouped by category.
   */
  laborCategories: publicProcedure.query(async () => {
    return fetchNourOS("/api/labor/estimate", { method: "POST" });
  }),

  /**
   * Create an instant quote — customer-facing.
   */
  createQuote: publicProcedure
    .input(
      z.object({
        vehicleYear: z.number().int(),
        vehicleMake: z.string().min(1),
        vehicleModel: z.string().min(1),
        vehicleEngine: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerEmail: z.string().email().optional(),
        services: z.array(z.string()).optional(), // operation IDs or names
        tires: z
          .array(
            z.object({
              id: z.string().optional(),
              brand: z.string().optional(),
              size: z.string().optional(),
              qty: z.number().int().default(4),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ input }) => {
      const result = await fetchNourOS("/api/quotes", {
        method: "POST",
        body: JSON.stringify({
          ...input,
          source: "website",
        }),
      });
      return result;
    }),

  /**
   * Look up a quote by ID or quote number — for the booking page.
   */
  getQuote: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => {
      return fetchNourOS(`/api/quotes/${encodeURIComponent(input.id)}`);
    }),
});
