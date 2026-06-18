import { apiHandler } from "@/lib/utils/http";
import { parseCSV, syncTransactions } from "@/lib/services/finance";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

/**
 * POST /api/finance/sync
 * Owner-gated CSV statement sync endpoint.
 */
export const POST = apiHandler(
  async (req) => {
    // Parse body as JSON or text.
    // If it's a multipart form or raw text, handle it.
    let csvText = "";

    try {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) {
        const body = await req.json();
        csvText = body.csv;
      } else {
        csvText = await req.text();
      }
    } catch (e) {
      throw new ServiceError("Failed to parse request body", 400);
    }

    if (!csvText || csvText.trim().length === 0) {
      throw new ServiceError("CSV content is required", 400);
    }

    try {
      const parsed = parseCSV(csvText);
      if (parsed.length === 0) {
        return { ok: true, imported: 0, skipped: 0, message: "CSV was empty or had no valid transactions." };
      }

      const { imported, skipped } = await syncTransactions(parsed);
      return { ok: true, imported, skipped };
    } catch (err) {
      throw new ServiceError(err instanceof Error ? err.message : "Failed to parse and sync CSV statement", 400);
    }
  },
  { auth: "owner" }
);
