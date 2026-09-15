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
import type { SettledState } from "@/lib/services/action-attempts";

/**
 * fenceContent (lib/ai/tool-result-fencing.ts) caps its body at 4000
 * chars by default and may PREPEND an injection annotation before
 * applying that cap. Anything built to fill a fence must budget for
 * both, or the fence truncates the very content it exists to label.
 */
const FENCE_BODY_CAP = 4000;
const ANNOTATION_SLACK = 200;

export const socialTools = {
  sendTelegram: tool({
    description: "Send a Telegram message to Nour. Use for proactive alerts, reminders, or important notifications that need to reach his phone.",
    inputSchema: z.object({
      message: z.string().describe("Message content"),
      title: z.string().optional().describe("Optional title/header for the message"),
      urgency: z.enum(["low", "medium", "high"]).default("medium"),
    }),
    execute: async ({ message, title, urgency }) => {
      const { formatTelegramNotification } = await import("@/lib/services/telegram");
      const { sendTelegramObserved } = await import("@/lib/services/telegram-observed");
      const { withToolIdempotency, idempotencyKey } = await import("./tool-idempotency");
      const prefix = urgency === "high" ? "🚨" : urgency === "medium" ? "📌" : "💬";
      const fullMessage = title
        ? formatTelegramNotification(title, `${prefix} ${message}`)
        : `${prefix} ${message}`;

      // 2026-09-15 · execution truth (salvaged from the nick-turn-control-plane
      // draft, PR #2326). Three things the legacy shape got wrong:
      //   · a live dedupe marker proves only that an identical attempt was
      //     CLAIMED — it is not a provider receipt. The old onDuplicate returned
      //     `sent: true`, fabricating a successful send from the marker alone.
      //   · legacy sendTelegram() folds a timeout/socket error into `false`, and
      //     the `succeeded` predicate then RELEASED the marker — so a send that
      //     may have committed was retried blindly (possible duplicate).
      //   · the model could not tell "failed" from "unknown". Now the result
      //     carries a state, and an `error` field on anything that is not
      //     provider_accepted, which existing tool telemetry reads as a soft
      //     failure — nothing downstream can mistake it for Done.
      type SendState =
        | "provider_accepted"
        | "known_failure"
        | "unknown_completion"
        | "duplicate_suppressed"
        | "idempotency_unavailable";
      type Result = {
        sent: boolean;
        state: SendState;
        urgency: typeof urgency;
        messageLength: number;
        deduped?: boolean;
        priorState?: "claimed" | "unknown";
        reason?: string;
        messageId?: number;
        error?: string;
        /**
         * 2026-09-15 · the durable ActionAttempt row this send is recorded
         * under (lib/services/action-attempts.ts). ledgerState is the state the
         * row settled to — SUCCEEDED_UNVERIFIED is the honest ceiling for a
         * Telegram send: the provider accepted it, nothing has read it back.
         * Both fields are stamped by the wrapper ONLY after the ledger confirmed
         * the settlement; absent means the ledger did not answer (missing
         * table → bridge, or the settle failed), never "assume it did".
         */
        attemptId?: string;
        ledgerState?: SettledState;
        priorAttemptState?: string;
      };
      return withToolIdempotency<Result>(
        idempotencyKey("sendTelegram", fullMessage),
        5 * 60_000,
        async () => {
          const outcome = await sendTelegramObserved(fullMessage);
          if (outcome.state === "provider_accepted") {
            return {
              sent: true,
              state: "provider_accepted",
              urgency,
              messageLength: fullMessage.length,
              messageId: outcome.messageId,
            };
          }
          return {
            sent: false,
            state: outcome.state,
            urgency,
            messageLength: fullMessage.length,
            reason: outcome.reason,
            error:
              outcome.state === "unknown_completion"
                ? `Telegram completion is unknown (${outcome.reason}); do not claim sent and do not retry blindly.`
                : `Telegram send failed (${outcome.reason}).`,
          };
        },
        (ctx) => {
          const reason =
            ctx?.state === "unknown"
              ? "A prior identical send has unknown completion; not retried."
              : "An identical send is already claimed inside the dedupe window; not re-executed.";
          return {
            sent: false,
            state: "duplicate_suppressed",
            urgency,
            messageLength: fullMessage.length,
            deduped: true,
            priorState: ctx?.state ?? "claimed",
            attemptId: ctx?.attemptId,
            priorAttemptState: ctx?.attemptState,
            reason,
            error: reason,
          };
        },
        undefined,
        {
          // 2026-09-15 · the durable delegation contract: one action_attempts row
          // per operation key, claimed BEFORE the send and settled with the
          // provider's message id. sendTelegram is the one consequential mission
          // the contract is proven on before it is generalised.
          durable: {
            tool: "sendTelegram",
            effectClass: "write",
            // Runs only after action_attempts confirmed the settlement.
            stamp: (r, ledger) => ({ ...r, attemptId: ledger.attemptId, ledgerState: ledger.state }),
          },
          externalReference: (r) => (r.messageId !== undefined ? `telegram:message:${r.messageId}` : undefined),
          classifyResult: (r) =>
            r.state === "provider_accepted" ? "success" : r.state === "known_failure" ? "known_failure" : "unknown",
          // An unknown transport outcome stays fenced long enough that an eager
          // model/client retry cannot double-send while the provider settles.
          unknownWindowMs: 30 * 60_000,
          // An externally visible send is worse duplicated than delayed: if the
          // claim store itself is unavailable, fail closed instead of sending untracked.
          onClaimUnavailable: () => {
            const reason = "Idempotency store unavailable; send blocked to prevent an untracked duplicate.";
            return { sent: false, state: "idempotency_unavailable", urgency, messageLength: fullMessage.length, reason, error: reason };
          },
        },
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

          // Telegram reports failure by RETURNING false, never by throwing.
          // Discarding it staged a PENDING receipt, told the operator to go
          // approve it, and — worse — committed the 10-minute dedup marker, so
          // a retry answered "already staged" while no approval prompt existed
          // anywhere. Nothing sweeps PENDING receipts. Same shape as the
          // sendTelegram tool above (:36/:40).
          // NB: this returns { ok, messageId }, not a boolean — an object is
          // always truthy, so it must be unwrapped.
          const prompted = await sendTelegramWithButtons(text, buttons);
          if (!prompted.ok) {
            return {
              status: "UNDELIVERED",
              receiptId: receipt.id,
              message:
                "SMS staged but the Telegram approval prompt could not be delivered — approve it from the receipts surface, or retry.",
            };
          }

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
        // Hold the marker ONLY when the operator actually got the prompt.
        (r) => r.status === "STAGED",
      );
    },
  }),

  draftOpportunitySms: tool({
    description:
      "Get the deterministic, evidence-only SMS draft for a Nick's Tire Decision-Inbox opportunity (from getTopDecisions). READ-ONLY — never sends. Returns the draft text, best channel, risk label, and masked customer identity. Call-first opportunity types (callbacks, complaints, overdue promises) return no draft with the reason — recommend the CALL instead. ALWAYS show Nour the returned draft verbatim before any talk of sending.",
    inputSchema: z.object({
      opportunityId: z.string().uuid().describe("The opportunity id from getTopDecisions"),
    }),
    execute: async ({ opportunityId }) => {
      try {
        const { queryNick } = await import("@/lib/nickstire/query");
        const res = await queryNick<Record<string, unknown>>("draft_opportunity_sms", { opportunityId });
        if ("error" in res) return { ok: false, error: res.error };
        return { ok: true, ...res.data };
      } catch (err) {
        const { sanitizeError } = await import("@/lib/utils/sanitize-error");
        return { ok: false, error: sanitizeError(err) };
      }
    },
  }),

  sendOpportunitySms: tool({
    description:
      "Stage a customer SMS for a Nick's Tire Decision-Inbox opportunity. NEVER sends directly: writes a PENDING ActionReceipt and sends Nour a Telegram Approve/Decline prompt showing the EXACT text — the real send happens only on his Approve tap (nickstire then enforces consent, caps, quiet hours, pause, and dedupe server-side; the send is receipted on the opportunity). CONTRACT: call draftOpportunitySms FIRST, show Nour the draft in chat, apply his edits, and only stage the final text he has seen. Identity comes from the opportunity row — there is no free-form phone targeting. For texting someone NOT in the Decision Inbox, use stageCustomerAlert instead.",
    inputSchema: z.object({
      opportunityId: z.string().uuid().describe("The opportunity id from getTopDecisions"),
      body: z.string().min(1).max(480).describe("The exact SMS text Nour has seen in chat (edits applied)"),
      customerLabel: z.string().optional().describe("Short label for the approval prompt, e.g. 'Sam (stale lead)'"),
    }),
    execute: async ({ opportunityId, body, customerLabel }) => {
      const { prisma } = await import("@/lib/prisma");
      const { sendTelegramWithButtons } = await import("@/lib/services/telegram");
      const { withToolIdempotency, idempotencyKey } = await import("./tool-idempotency");
      const { createHash } = await import("crypto");

      // The bridge idempotency key derives from the approved CONTENT: the
      // same opportunity + the same exact text can only ever send once,
      // no matter how many times the receipt flow is replayed (§8).
      const bridgeKey = `opp-${opportunityId.slice(0, 8)}-${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
      const verificationPayload = {
        kind: "opportunity_sms" as const,
        opportunityId,
        body,
        idempotencyKey: bridgeKey,
        customerLabel: customerLabel || "customer",
      };

      return withToolIdempotency<{ status: string; receiptId: string | null; message: string }>(
        idempotencyKey("sendOpportunitySms", bridgeKey),
        10 * 60_000,
        async () => {
          const receipt = await prisma.actionReceipt.create({
            data: {
              action: "shop.sendOpportunitySms",
              status: "PENDING",
              sourceSystem: "nickstire-bridge",
              context: `Opportunity SMS approval for ${verificationPayload.customerLabel} (opp ${opportunityId.slice(0, 8)}…): "${body}"`,
              verificationPayload,
            },
          });

          const text =
            `📬 <b>Opportunity SMS — approval needed</b>\n\n` +
            `<b>To:</b> ${verificationPayload.customerLabel}\n` +
            `<b>Text:</b> "${body}"\n\n` +
            `Sends through Nick's Tire's full gate stack (consent, caps, quiet hours) and receipts the opportunity:`;

          const buttons = [
            [
              { text: "✓ Approve & Send", callback_data: `oppsms:approve:${receipt.id}` },
              { text: "✗ Decline", callback_data: `oppsms:deny:${receipt.id}` },
            ],
          ];

          // See stageCustomerAlert: a discarded boolean here both misreports
          // delivery AND commits the dedup marker, so the retry is refused
          // while no approval prompt exists.
          // NB: this returns { ok, messageId }, not a boolean — an object is
          // always truthy, so it must be unwrapped.
          const prompted = await sendTelegramWithButtons(text, buttons);
          if (!prompted.ok) {
            return {
              status: "UNDELIVERED",
              receiptId: receipt.id,
              message:
                "Staged but the Telegram approval prompt could not be delivered — approve it from the receipts surface, or retry.",
            };
          }

          return {
            status: "STAGED",
            receiptId: receipt.id,
            message: "Staged. Awaiting Nour's Approve tap on Telegram — nothing sends until then.",
          };
        },
        () => ({
          status: "DEDUPED",
          receiptId: null,
          message: "This exact text for this opportunity was already staged — not re-staged.",
        }),
        (r) => r.status === "STAGED",
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
        // `subject` and `from` are attacker-chosen: anyone who can email
        // Nour picks those 200 characters. They used to be returned RAW
        // beside an already-fenced snippet, which made this the cheapest
        // injection surface in the app -- no page to host, no link to
        // click, just send mail and land unlabelled text in model
        // context. Fencing them TOGETHER with the snippet as one block
        // keeps the fence count per thread at exactly one, so closing
        // the hole costs no extra tokens (a per-field fence would have
        // added ~90 chars x 60 fields on a 30-thread listing).
        threads: threads.slice(0, 30).map((t) => ({
          id: t.id,
          messageCount: t.messageCount,
          unread: t.unread,
          content: fenceContent(
            "arsenalGmailInbox",
            "external_doc",
            `Subject: ${t.subject.slice(0, 200)}\nFrom: ${t.from.slice(0, 200)}\n\n${t.snippet.slice(0, 300)}`,
          ),
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
        messageCount: thread.messages.length,
        // Same reasoning as arsenalGmailInbox above: subject / from / to
        // are sender-controlled and were returned unfenced next to a
        // fenced body. The per-message body budget is derived below.
        subject: fenceContent(
          "arsenalGmailReadThread",
          "external_doc",
          thread.subject.slice(0, 200),
        ),
        messages: thread.messages.map((m) => {
          // 2026-09-02 review P2 · the 3700 slice was arithmetic I got
          // wrong. At maximum field lengths the header reaches ~484 chars
          // (200 From + 200 To + 64 Date + labels + newlines), so
          // 3700 + 484 = 4184 against fenceContent's 4000-char body cap:
          // long mail silently lost its last ~184 characters while the
          // comment beside it claimed the slice PREVENTED truncation.
          // Derive the allowance from the header actually built, and keep
          // slack for the injection annotation fenceContent may prepend
          // BEFORE applying that cap.
          const header = `From: ${m.from.slice(0, 200)}
To: ${m.to.slice(0, 200)}
Date: ${String(m.date).slice(0, 64)}

`;
          const bodyBudget = Math.max(500, FENCE_BODY_CAP - ANNOTATION_SLACK - header.length);
          return {
            content: fenceContent(
              "arsenalGmailReadThread",
              "external_doc",
              `${header}${m.body.slice(0, bodyBudget)}`,
            ),
          };
        }),
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
