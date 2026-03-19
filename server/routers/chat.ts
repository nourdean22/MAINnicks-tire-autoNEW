/**
 * Chat router — AI chat assistant for customer interactions.
 */
import { publicProcedure, router } from "../_core/trpc";
import { chatWithAssistant } from "../gemini";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { chatSessions } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const chatRouter = router({
  message: publicProcedure
    .input(z.object({
      sessionId: z.number().optional(),
      message: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      const d = await db();

      let sessionMessages: Array<{ role: string; content: string }> = [];
      let sessionId = input.sessionId;

      if (sessionId && d) {
        const existing = await d.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
        if (existing.length > 0) {
          try {
            sessionMessages = JSON.parse(existing[0].messagesJson);
          } catch {}
        }
      }

      sessionMessages.push({ role: "user", content: input.message });

      const { reply, extractedInfo } = await chatWithAssistant(sessionMessages);

      sessionMessages.push({ role: "assistant", content: reply });

      if (d) {
        if (sessionId) {
          await d.update(chatSessions).set({
            messagesJson: JSON.stringify(sessionMessages),
            vehicleInfo: extractedInfo?.vehicle || undefined,
            problemSummary: extractedInfo?.problem || undefined,
          }).where(eq(chatSessions.id, sessionId));
        } else {
          const result = await d.insert(chatSessions).values({
            messagesJson: JSON.stringify(sessionMessages),
            vehicleInfo: extractedInfo?.vehicle || null,
            problemSummary: extractedInfo?.problem || null,
          });
          sessionId = Number(result[0].insertId);
        }
      }

      return { sessionId, reply, extractedInfo };
    }),
});
