import { prisma } from "@/lib/prisma";

/**
 * Format active/snoozed agenda items (commitments, intentions, contradictions)
 * as a Markdown block for V1 prompt compilation.
 */
export async function getAgendaItemsContext(): Promise<string> {
  const items = await prisma.agendaItem.findMany({
    where: {
      status: { in: ["ACTIVE", "SNOOZED"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      category: true,
      title: true,
      description: true,
      dueDate: true,
    },
  }).catch(() => []);

  if (items.length === 0) return "";

  const lines = [
    "── ACTIVE AGENDA ITEMS ──",
    "These are the operator's active witnessed commitments, standing intentions, contradictions, or neglect alerts.",
    "Hold Nour accountable to these commitments, address ongoing contradictions, or execute standing intentions.",
  ];

  for (const item of items) {
    const categoryLabel = item.category.replace(/_/g, " ");
    const dueDateStr = item.dueDate
      ? ` (Due: ${new Date(item.dueDate).toISOString().slice(0, 10)})`
      : "";
    lines.push(`- [${categoryLabel}] ${item.title}${dueDateStr}`);
    if (item.description) {
      lines.push(`  Description: ${item.description}`);
    }
  }

  return lines.join("\n");
}
