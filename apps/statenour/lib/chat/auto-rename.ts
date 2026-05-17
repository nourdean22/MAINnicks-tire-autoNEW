/**
 * Chat Auto-Rename — regenerate conversation titles after the user
 * has sent enough to summarize.
 *
 * Item #9 from the excellence marathon. Conversations currently show
 * the first 80 chars of the first message forever. After message #4,
 * we call a quick classification to produce a better 3-6 word title.
 *
 * Triggered from the chat route's onFinish handler when the conversation
 * has 4+ messages AND hasn't been renamed yet (title still matches
 * the first-message prefix pattern).
 */

import { prisma } from "@/lib/prisma";
// v10.0.64 · AgentTrace coverage.
import { makeTracedAiChat } from "@/lib/ai/traced-aichat";
const aiChat = makeTracedAiChat("chat-auto-rename", "chat");
import { recordError } from "@/lib/errors/record-error";

// Minimum messages before we rename — we want enough context to
// generate a meaningful title, but not so many that the rename feels
// delayed.
const MIN_MESSAGES_FOR_RENAME = 4;

// v9.1.22 · in-memory dedup of currently-renaming conversation IDs.
// The DB-level dedup via auditEvent is correct on its own, BUT the
// chat route fires maybeAutoRename via fire-and-forget. Two rapid
// consecutive messages can both pass the renameMarker check before
// either run has written the auditEvent — both then call Venice and
// both write the title (second clobbers first). This Set short-
// circuits the second call entirely. Cleared in finally block.
const inFlight = new Set<string>();

export async function maybeAutoRename(conversationId: string): Promise<void> {
  // v9.1.22 · skip if a concurrent call is already renaming this conv.
  if (inFlight.has(conversationId)) return;
  inFlight.add(conversationId);
  try {
    // ChatConversation doesn't have a metadata field (checked schema),
    // so we track "already renamed" via an auditEvent row keyed by
    // conversationId. Look for an existing "chat_renamed" event first.
    const [conv, messageCount, renameMarker] = await Promise.all([
      prisma.chatConversation.findUnique({
        where: { id: conversationId },
        select: { id: true, title: true },
      }),
      prisma.chatMessage.count({ where: { conversationId } }),
      prisma.auditEvent.findFirst({
        where: { eventType: "chat_renamed", detail: conversationId },
        select: { id: true },
      }),
    ]);

    if (!conv) return;
    if (messageCount < MIN_MESSAGES_FOR_RENAME) return;
    if (renameMarker) return; // Already renamed previously

    // Pull the first 6 messages for the title classification
    const messages = await prisma.chatMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { role: true, content: true },
    });

    if (messages.length === 0) return;

    // Build a compact transcript for the title model
    const transcript = messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content.slice(0, 400)}`)
      .join("\n");

    const systemPrompt = `You generate 4-8 word conversation titles. Rules:
- Start with a verb when possible (e.g. "Debugging the chat stall", "Planning v10.3")
- No trailing punctuation
- No quotes around the title
- Return ONLY the title text — no preamble, no explanation
- Capture the SUBSTANCE, not the pleasantries ("Hi Nick, got a sec" → "Quick check-in about X")`;

    const result = await aiChat(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate a concise title for this conversation:\n\n${transcript}`,
        },
      ],
      "classify"
    );

    if (!result.content || result.provider === "none") return;

    // Clean the title — strip quotes, trim whitespace, cap length
    let title = result.content
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/^title:\s*/i, "")
      .split("\n")[0]
      .trim();

    if (title.length > 80) title = title.slice(0, 80);
    if (title.length < 3) return; // Too short — bail

    // Update the conversation title + log the rename marker to
    // auditEvent so we don't re-rename it on every subsequent message.
    await Promise.all([
      prisma.chatConversation.update({
        where: { id: conversationId },
        data: { title },
      }),
      prisma.auditEvent.create({
        data: {
          actor: "chat_auto_rename",
          eventType: "chat_renamed",
          detail: conversationId,
          payload: JSON.parse(
            JSON.stringify({
              title,
              renamedAt: new Date().toISOString(),
              renamedModel: result.model,
              messageCount,
            })
          ),
        },
      }),
    ]);
  } catch (err) {
    recordError("chat:post-process", err, {
      stage: "auto-rename",
      conversationId,
    });
  }
}
