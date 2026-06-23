/**
 * POST /api/intelligence/ingest — owner-only · trigger manual ingestion for a specific source
 */
import { runIngestion } from "@/lib/intelligence/ingest";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { z } from "zod";

export const dynamic = "force-dynamic";

const IngestSchema = z.object({
  sourceId: z.string().cuid(),
});

export const POST = apiHandler(async (req) => {
  const payload = await readRequestJson(req);
  const parsed = IngestSchema.parse(payload);

  const result = await runIngestion(parsed.sourceId);

  if (!result.success) {
    return {
      status: "error",
      message: result.message,
    };
  }

  return {
    status: "success",
    documentId: result.documentId,
    claimsCount: result.claimsCount,
    message: result.message,
  };
}, { auth: "owner" });
