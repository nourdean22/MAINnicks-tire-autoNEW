/**
 * Social + comms tools — comms (telegram + gmail + email).
 *
 * Includes: sendTelegram · arsenalGmailInbox · arsenalGmailReadThread ·
 * composeEmail.
 *
 * v10.0.529.106 · Wave 82 · extracted from monolithic lib/ai/tools.ts.
 * Aggregate barrel: lib/ai/tools.ts re-exports nourTools composed from
 * all 7 domain files. Catalog source of truth: lib/ai/tools/catalog.ts.
 */

import { tool } from "ai";
import { z } from "zod";

export const socialTools = {
  sendTelegram: tool({
    description: "Send a Telegram message to Nour. Use for proactive alerts, reminders, or important notifications that need to reach his phone.",
    inputSchema: z.object({
      message: z.string().describe("Message content"),
      title: z.string().optional().describe("Optional title/header for the message"),
      urgency: z.enum(["low", "medium", "high"]).default("medium"),
    }),
    execute: async ({ message, title, urgency }) => {
      const { sendTelegram, formatTelegramNotification } = await import("@/lib/services/telegram");
      const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
      const fullMessage = title
        ? formatTelegramNotification(title, `${prefix} ${message}`)
        : `${prefix} ${message}`;
      const sent = await sendTelegram(fullMessage);
      return { sent, urgency, messageLength: fullMessage.length };
    },
  }),

  arsenalGmailInbox: tool({
    description: "List recent Gmail inbox threads · supports Gmail search syntax (e.g. 'is:unread newer_than:2d', 'from:supplier@x'). Returns subject/from/snippet/unread per thread. Requires GMAIL_REFRESH_TOKEN env (see docs/gmail-setup.md).",
    inputSchema: z.object({
      maxResults: z.number().optional().describe("Max threads to return · default 20"),
      query: z.string().optional().describe("Gmail search query · e.g. 'is:unread' or 'from:foo@bar.com'"),
    }),
    execute: async ({ maxResults, query }) => {
      const { listInbox, isGmailConfigured } = await import("@/lib/integrations/gmail");
      if (!isGmailConfigured()) {
        return { error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md" };
      }
      const threads = await listInbox({ maxResults, query });
      return {
        threadCount: threads.length,
        threads: threads.slice(0, 30).map((t) => ({
          id: t.id,
          subject: t.subject.slice(0, 200),
          from: t.from.slice(0, 200),
          snippet: t.snippet.slice(0, 300),
          messageCount: t.messageCount,
          unread: t.unread,
        })),
        source: "arsenal/gmail",
      };
    },
  }),

  arsenalGmailReadThread: tool({
    description: "Fetch a full Gmail thread · all messages decoded. Use after listing inbox to read specific threads.",
    inputSchema: z.object({
      threadId: z.string().describe("Gmail thread ID from arsenalGmailInbox"),
    }),
    execute: async ({ threadId }) => {
      const { getThread, isGmailConfigured } = await import("@/lib/integrations/gmail");
      if (!isGmailConfigured()) {
        return { error: "GMAIL_REFRESH_TOKEN not set · see docs/gmail-setup.md" };
      }
      const thread = await getThread(threadId);
      return {
        id: thread.id,
        subject: thread.subject.slice(0, 200),
        messageCount: thread.messages.length,
        messages: thread.messages.map((m) => ({
          from: m.from.slice(0, 200),
          to: m.to.slice(0, 200),
          date: m.date,
          body: m.body.slice(0, 4000),
        })),
        source: "arsenal/gmail",
      };
    },
  }),

  // v10.0.374 · spawn N sub-agents in parallel + synthesize
  composeEmail: tool({
    description:
      "Draft an email for Nour to review and explicitly send. NEVER auto-sends — returns a draft card the user clicks Send on. If Gmail is configured, also creates a draft in Nour's Gmail drafts directly via the Gmail API. Use when Nour says 'email X about Y', 'draft a note to ...', or asks for a written follow-up. If subject/body are not provided, the tool uses the `intent` to ask Nick to draft them in his next reply turn (preferred path: Nick writes the draft inline and passes it here as subject + body).",
    inputSchema: z.object({
      to: z.string().email().max(254).describe("Recipient email address"),
      subject: z.string().min(1).max(998).describe("Email subject line"),
      body: z.string().min(1).max(50_000).describe("Plain-text email body. Markdown is OK; will render as plain text."),
      tone: z
        .enum(["formal", "casual", "firm", "warm"])
        .default("warm")
        .describe("Tone hint shown on the draft card so Nour can sanity-check at a glance"),
    }),
    execute: async ({ to, subject, body, tone }) => {
      const { createDraft, isGmailConfigured } = await import("@/lib/integrations/gmail");
      let apiResult = null;
      if (isGmailConfigured()) {
        try {
          apiResult = await createDraft({ to, subject, body });
        } catch (err) {
          apiResult = { error: err instanceof Error ? err.message : String(err) };
        }
      }
      const payload = JSON.stringify({ to, subject, body, tone, apiResult });
      return {
        markdown: `\n\`\`\`email-draft\n${payload}\n\`\`\`\n`,
        summary: apiResult && !("error" in apiResult)
          ? `Gmail draft created via API to ${to}: "${subject.slice(0, 60)}${subject.length > 60 ? "…" : ""}" (Draft ID: ${apiResult.draftId})`
          : `Email drafted to ${to}: "${subject.slice(0, 60)}${subject.length > 60 ? "…" : ""}"${apiResult?.error ? ` (API Error: ${apiResult.error})` : ""}`,
        draft: { to, subject, bodyChars: body.length, tone, apiResult },
      };
    },
  }),

  triggerInstagramAutopost: tool({
    description: "Run the Instagram Autopost pipeline immediately. Supports triggering dry-runs (evaluates but doesn't post) or live publishes. Optionally steer with a specific content archetype.",
    inputSchema: z.object({
      dryRun: z.boolean().default(true).describe("If true, only generates and evaluates. If false, posts live to Instagram/Facebook immediately."),
      forceArchetype: z.enum(["educational", "promo", "behind_scenes", "testimonial", "meme", "tips", "showcase"]).optional().describe("Force a content archetype angle for the generated post."),
    }),
    execute: async ({ dryRun, forceArchetype }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const result = await queryNick("instagram_autopost_run", { dryRun, forceArchetype });
      return result;
    },
  }),

  getInstagramAutopostStatus: tool({
    description: "Get the current status of the Instagram/Facebook autopost system, including the active configuration and a history of the 5 most recent posts (statuses, scores, captions, errors, and image URLs).",
    inputSchema: z.object({}),
    execute: async () => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const result = await queryNick("instagram_autopost_status");
      return result;
    },
  }),

  setInstagramAutopostConfig: tool({
    description: "Enable or disable the global Instagram/Facebook live autoposter configuration.",
    inputSchema: z.object({
      enabled: z.boolean().describe("Set to true to allow scheduled live autoposting, or false to restrict to dry-runs only."),
    }),
    execute: async ({ enabled }) => {
      const { queryNick } = await import("@/lib/nickstire/query");
      const result = await queryNick("instagram_autopost_set_config", { enabled });
      return result;
    },
  }),

  // ── BUSINESS-OVERSIGHT TOOLS (read-only) ──
  // v7 cleanup · Apr 28 · sendSMS / sendBulkSMS / triggerFollowUp /
  // createPaymentLink were MUTATING business actions — those belong on
  // nickstire.org/admin (real customer DB, real Twilio creds, real
  // Stripe webhook surface). Removed here. Read-only oversight tools
  // (revenue, reviews, dashboards) kept since autonicks's role is
  // "oversee the shop at a high level + link to admin for details."

};
