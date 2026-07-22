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
      const { withToolIdempotency, idempotencyKey } = await import("./tool-idempotency");
      const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
      const fullMessage = title
        ? formatTelegramNotification(title, `${prefix} ${message}`)
        : `${prefix} ${message}`;
      // Idempotent: a re-run of this turn (auto-regen / retry / best-of-2) with the
      // same message inside 5 min does not send a duplicate.
      return withToolIdempotency(
        idempotencyKey("sendTelegram", fullMessage),
        5 * 60_000,
        async () => {
          const sent = await sendTelegram(fullMessage);
          return { sent, urgency, messageLength: fullMessage.length };
        },
        () => ({ sent: true, deduped: true, urgency, messageLength: fullMessage.length }),
        (r) => r.sent === true, // sendTelegram returns false (no throw) on failure — release the marker then
      );
    },
  }),

  stageCustomerAlert: tool({
    description: "Stage an SMS outreach to a customer for approval. Writes a PENDING ActionReceipt and sends a Telegram approval prompt to Nour.",
    inputSchema: z.object({
      phone: z.string().describe("Phone number in E.164 format or standard 10-digit digits"),
      message: z.string().describe("SMS message content, <= 160 characters"),
      customerName: z.string().optional().describe("Optional customer name for context"),
    }),
    execute: async ({ phone, message, customerName }) => {
      const { prisma } = await import("@/lib/prisma");
      const { sendTelegramWithButtons } = await import("@/lib/services/telegram");
      const { withToolIdempotency, idempotencyKey } = await import("./tool-idempotency");

      const verificationPayload = {
        phone,
        message,
        customerName: customerName || "Unknown Customer",
      };

      // Idempotent: a re-run with the same phone+message inside 10 min does not
      // create a duplicate PENDING receipt or a duplicate approval nudge.
      return withToolIdempotency<{ status: string; receiptId: string | null; message: string }>(
        idempotencyKey("stageCustomerAlert", `${phone}|${message}`),
        10 * 60_000,
        async () => {
          const receipt = await prisma.actionReceipt.create({
            data: {
              action: "shop.sendSms",
              status: "PENDING",
              sourceSystem: "twilio",
              context: `SMS outreach approval for ${verificationPayload.customerName} (${phone}): "${message}"`,
              verificationPayload,
            },
          });

          const text = `📬 <b>Staged SMS Outreach</b>\n\n` +
            `<b>To:</b> ${verificationPayload.customerName} (${phone})\n` +
            `<b>Message:</b> "${message}"\n\n` +
            `Awaiting your confirmation to send via Twilio SMS:`;

          const buttons = [
            [
              { text: "✓ Approve & Send", callback_data: `approve:${receipt.id}` },
              { text: "✗ Decline", callback_data: `deny:${receipt.id}` }
            ]
          ];

          await sendTelegramWithButtons(text, buttons);

          return {
            status: "STAGED",
            receiptId: receipt.id,
            message: "SMS staged. Awaiting approval on your Telegram app.",
          };
        },
        () => ({
          status: "DEDUPED",
          receiptId: null,
          message: "An identical SMS to this customer was already staged moments ago — not re-staged.",
        }),
        (r) => r.status === "STAGED", // only a committed receipt holds the dedup marker
      );
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
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
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
          snippet: fenceContent("arsenalGmailInbox", "external_doc", t.snippet.slice(0, 300)),
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
      const { fenceContent } = await import("@/lib/ai/tool-result-fencing");
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
          body: fenceContent("arsenalGmailReadThread", "external_doc", m.body.slice(0, 4000)),
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
      // Dry-runs are side-effect-free. For LIVE publishes, guard against a
      // re-run of this turn (auto-regen / retry / best-of-2) publishing a SECOND
      // public post. Fixed key (content is generated fresh each run) + 15-min window.
      if (dryRun) {
        return queryNick("instagram_autopost_run", { dryRun, forceArchetype });
      }
      const { withToolIdempotency } = await import("./tool-idempotency");
      return withToolIdempotency<
        Awaited<ReturnType<typeof queryNick>> | { deduped: boolean; status: string; message: string }
      >(
        `triggerInstagramAutopost:live${forceArchetype ? `:${forceArchetype}` : ""}`,
        15 * 60_000,
        () => queryNick("instagram_autopost_run", { dryRun, forceArchetype }),
        () => ({
          deduped: true,
          status: "skipped",
          message: "A live Instagram autopost was already triggered in the last 15 minutes — not re-posted (duplicate-guard).",
        }),
        (r) => !((r as { error?: unknown })?.error), // queryNick returns {error} (no throw) on failure — release then
      );
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

  // 2026-07-06 · manual Gmail ingest trigger — companion to syncCalendar /
  // syncDriveMemory. The OAuth callback page advertises "sync my gmail" but no
  // tool existed. Calls the ingest-gmail cron on-demand (Bearer). Auto-attaches
  // via the existing email keyword family (tool name contains "gmail").
  syncGmail: tool({
    description:
      "Manually trigger a Gmail ingest — pulls recent messages into statenour-os (classification + BrainMemory) right now instead of waiting for the scheduled cron. Use when Nour says 'sync my gmail', 'refresh my inbox', or 'pull my latest emails'. Returns ingest stats; if OAuth is expired it returns an actionable re-grant hint.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const base =
          process.env.NEXT_PUBLIC_SITE_URL ||
          process.env.APP_BASE_URL ||
          "http://localhost:3000";
        const res = await fetch(`${base}/api/cron/ingest-gmail`, {
          method: "GET",
          headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}` },
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          return { ok: false, error: `Gmail sync failed with HTTP ${res.status}` };
        }
        const json = (await res.json()) as { data?: Record<string, unknown> };
        const data = json.data ?? (json as Record<string, unknown>);
        // `skipped` is a boolean on the no-account skip path, a count on success.
        if (data.skipped === true) {
          return {
            ok: false,
            skipped: true,
            reason: data.reason ?? "gmail ingest skipped",
            configuredAccounts: data.configuredAccounts ?? 0,
            hint: "No Google account connected — re-grant at /api/oauth/google-data/start.",
          };
        }
        const outgoing = Number(data.outgoingStored ?? 0);
        const inbound = Number(data.inboundStored ?? 0);
        return {
          ok: true,
          outgoingStored: outgoing,
          inboundStored: inbound,
          classified: Number(data.classified ?? 0),
          hint:
            outgoing + inbound > 0
              ? `Ingested ${outgoing + inbound} Gmail messages (${inbound} inbound, ${outgoing} outgoing). Ask about your inbox to reach them.`
              : "Inbox already up to date — no new messages to ingest.",
        };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Unknown gmail sync error",
        };
      }
    },
  }),

};
