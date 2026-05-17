import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
export const maxDuration = 60;

export const POST = apiHandler(async () => {
  // Gather brain data for analysis
  const [memories, predictions, contradictions, alerts] = await Promise.all([
    prisma.brainMemory.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.prediction.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "desc" }, take: 10 }).catch(() => []),
    prisma.brainMemory.findMany({ where: { category: "contradiction" }, orderBy: { createdAt: "desc" }, take: 5 }).catch(() => []),
    prisma.driftAlert.findMany({ where: { resolved: false }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  // Try AI analysis if available
  let aiSummary: string | null = null;
  try {
    const { getModel, getActiveProviderInfo } = await import("@/lib/ai/provider");
    const { generateText } = await import("ai");
    const { mintTraceId, recordTrace } = await import("@/lib/ai/agent-trace");
    const model = getModel();
    const { provider, modelId } = getActiveProviderInfo();

    const context = [
      `Memories (${memories.length}): ${memories.slice(0, 5).map(m => m.content?.slice(0, 100)).join(" | ")}`,
      `Unresolved alerts (${alerts.length}): ${alerts.slice(0, 3).map(a => a.message?.slice(0, 80)).join(" | ")}`,
      `Pending predictions: ${predictions.length}`,
      `Contradictions: ${contradictions.length}`,
    ].join("\n");

    const traceId = mintTraceId();
    const startedAt = Date.now();
    const { text } = await generateText({
      model,
      prompt: `Analyze this brain state and give 3 actionable insights in bullet points. Be specific and direct.\n\n${context}`,
      maxOutputTokens: 300,
    });
    aiSummary = text;
    void recordTrace(
      {
        traceId,
        source: "brain",
        label: "brain-analyze",
        provider,
        model: modelId,
        inputChars: context.length,
      },
      {
        durationMs: Date.now() - startedAt,
        outputChars: text.length,
      },
    );
  } catch {}

  return {
    memoryCount: memories.length,
    predictionCount: predictions.length,
    contradictionCount: contradictions.length,
    unresolvedAlerts: alerts.length,
    aiSummary,
    analyzedAt: new Date().toISOString(),
  };
}, { auth: "owner" });
