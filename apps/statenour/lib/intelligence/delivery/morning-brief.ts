import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";

export async function compileMorningBrief() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

  // Fetch signals from the last 24 hours that are BRIEFING or OVERRIDE tier
  const signals = await prisma.intelligenceSignal.findMany({
    where: {
      createdAt: { gte: yesterday },
      actionabilityIndex: { gte: 60 }
    },
    orderBy: { actionabilityIndex: "desc" }
  });

  if (signals.length === 0) {
    console.log("[Morning Brief] No actionable signals in the last 24h.");
    return;
  }

  let briefContent = `# Commander's Brief: ${today.toISOString().split("T")[0]}\n\n`;
  briefContent += `## Top Signals\n\n`;

  for (const sig of signals) {
    const icon = sig.actionabilityIndex >= 90 ? "🚨" : "📊";
    briefContent += `### ${icon} [${sig.actionabilityIndex}] ${sig.title}\n`;
    briefContent += `**Source:** ${sig.source}\n`;
    briefContent += `**The Delta:** ${sig.derivativeContext || sig.summary}\n`;
    
    // Attempt to cast metadata safely
    const meta = sig.metadata as Record<string, unknown> | null;
    if (meta?.suggestedAction) {
      briefContent += `**Action:** ${meta.suggestedAction}\n`;
    }
    briefContent += `\n---\n\n`;
  }

  // Ensure the briefs directory exists
  const briefsDir = path.join(process.cwd(), "public/briefs");
  if (!fs.existsSync(briefsDir)) {
    fs.mkdirSync(briefsDir, { recursive: true });
  }

  const filename = `${today.toISOString().split("T")[0]}.md`;
  const filepath = path.join(briefsDir, filename);

  fs.writeFileSync(filepath, briefContent, "utf8");
  console.log(`[Morning Brief] Rendered to ${filepath}`);
  
  // Optionally update status of these signals to BRIEFED
  await prisma.intelligenceSignal.updateMany({
    where: {
      id: { in: signals.map((s: { id: string }) => s.id) }
    },
    data: { status: "BRIEFED" }
  });
}
