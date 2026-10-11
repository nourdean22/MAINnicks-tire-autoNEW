import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { safeEqual } from "@/lib/auth-guard";
import { tracedAiChat } from "@/lib/ai/traced-aichat";
import { fenceContent } from "@/lib/ai/tool-result-fencing";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { ServiceError } from "@/lib/utils/service-error";
import { logger } from "@/lib/logger";

const log = logger.withSurface("webhooks/inbound-crm");

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/inbound-crm
 * Endpoint that processes inbound emails/texts.
 * Uses tracedAiChat to extract commitments and update/create contacts.
 */
export const POST = apiHandler(
  async (req) => {
    // 1. Verify authorization secret — HEADER ONLY.
    // Secrets in headers aren't captured by proxy/CDN/access logs the way
    // query strings are. The legacy `?secret=` fallback (kept "transitionally"
    // since #597, 2026-07-07) was removed 2026-09-07: the retained Railway
    // runtime log window held ZERO `inbound_crm_*` lines at all, so no caller
    // was on the query path — and a caller that still is now fails loudly
    // with `inbound_crm_unauthorized` + `presented_via: "query"` instead of
    // silently leaking its secret into every access log on the way in.
    // Compared constant-time. tests/security/inbound-crm-header-secret.test.ts.
    const headerSecret = req.headers.get("x-sync-key");
    const querySecret = new URL(req.url).searchParams.get("secret");
    const expectedSecret = process.env.STATENOUR_SYNC_KEY || process.env.BRIDGE_API_KEY;

    // Fail CLOSED: never process an inbound webhook when no secret is configured.
    // A missing secret is a misconfiguration, not an open door.
    if (!expectedSecret) {
      log.error("inbound_crm_secret_unconfigured");
      throw new ServiceError("Webhook authentication is not configured.", 503);
    }
    if (!headerSecret || !safeEqual(headerSecret, expectedSecret)) {
      log.warn("inbound_crm_unauthorized", {
        presented_via: headerSecret ? "header" : querySecret ? "query" : "none",
        detail: querySecret && !headerSecret
          ? "Secret arrived as ?secret= — the query path was retired 2026-09-07; send the x-sync-key header."
          : undefined,
      });
      throw new ServiceError("Unauthorized", 401);
    }

    let bodyPayload;
    try {
      bodyPayload = await req.json();
    } catch (e) {
      throw new ServiceError("Invalid JSON body", 400);
    }

    const { from, body, subject } = bodyPayload;
    if (!from || !body) {
      throw new ServiceError("Missing from or body fields", 400);
    }

    // Shape only: the sender and subject are a stranger's PII and text (07-SN-08).
    log.info("inbound_crm_received", { fromKind: String(from).includes("@") ? "email" : "phone", subjectChars: subject?.length ?? 0 });

    // 2. Identify or create Contact
    const isEmail = from.includes("@");
    let contact = await prisma.contact.findFirst({
      where: isEmail ? { email: from } : { phone: from },
    });

    if (!contact) {
      const defaultName = isEmail ? from.split("@")[0] : from;
      contact = await prisma.contact.create({
        data: {
          name: defaultName,
          email: isEmail ? from : null,
          phone: isEmail ? null : from,
          role: "lead",
          status: "active",
        },
      });
      log.info("contact_created_from_inbound", { id: contact.id });
    }

    // 3. Process the message using tracedAiChat. Sender, subject and body are a stranger's text: fenced (07-SN-09).
    const prompt = `INBOUND MESSAGE:
${fenceContent("inbound-crm", "external_doc", `FROM: ${from} (Name: ${contact.name})\nSUBJECT: ${subject || "none"}\nBODY:\n${body}`)}

Analyze the message above to extract key contact info and commitments.
Return ONLY a valid JSON object matching this schema:
{
  "contactName": "Extracted name of the sender, or null if not mentioned/unclear",
  "motivations": "Short summary of sender's motivation or null",
  "goals": ["List of goals Nour can help them with"],
  "painPoints": ["List of current challenges / pain points"],
  "commitments": [
    {
      "title": "Short summary of Nour's commitment or task (e.g. 'Follow up with pricing')",
      "dueDate": "YYYY-MM-DD format, or null if no deadline mentioned",
      "assignee": "nour" | "contact"
    }
  ]
}`;

    const systemPrompt =
      "You are Nick, Nour's Chief of Staff. You process incoming emails and texts to update Nour's CRM and task tracking. Parse the message and return ONLY a valid JSON object.";

    const result = await tracedAiChat(
      { label: "inbound-crm-parse", source: "tool" },
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      "fast"
    );

    let parsed: any = {};
    try {
      parsed = JSON.parse(result.content.replace(/```json|```/g, "").trim());
    } catch (err) {
      log.error("inbound_crm_parse_json_failed", { chars: result.content.length });
      throw new ServiceError("Failed to parse AI response", 500);
    }

    // 4. Update Contact Name and Psych Profile. Role and status are NOT taken from the model: the sender
    // wrote the text it read, and they drive the weekly crm-followups cron (07-SN-09).
    const updatedData: any = {};
    if (parsed.contactName && contact.name === from) {
      updatedData.name = parsed.contactName;
    }

    const currentPsychProfile = (contact.psychProfile as Record<string, any>) || {};
    const psychProfile = {
      ...currentPsychProfile,
      motivations: parsed.motivations || currentPsychProfile.motivations || null,
      goals: [...new Set([...(parsed.goals || []), ...(currentPsychProfile.goals || [])])],
      painPoints: [...new Set([...(parsed.painPoints || []), ...(currentPsychProfile.painPoints || [])])],
    };
    updatedData.psychProfile = JSON.parse(JSON.stringify(psychProfile));

    if (body) {
      const dateStr = new Date().toLocaleDateString();
      updatedData.notes = (contact.notes ? contact.notes + "\n\n" : "") + `[Inbound Message (external, unverified) ${dateStr}]: ${body}`;
    }

    contact = await prisma.contact.update({
      where: { id: contact.id },
      data: updatedData,
    });

    log.info("contact_profile_updated", { id: contact.id });

    // 5. Create Tasks from Commitments
    let tasksCreated = 0;
    if (Array.isArray(parsed.commitments) && parsed.commitments.length > 0) {
      const inboxMissionId = await resolveInboxMissionId();

      for (const commitment of parsed.commitments) {
        if (commitment.assignee === "nour" && commitment.title) {
          const dueDate = commitment.dueDate ? new Date(commitment.dueDate) : null;
          await prisma.task.create({
            data: {
              title: commitment.title,
              nextPhysicalAction: commitment.title,
              missionId: inboxMissionId,
              status: "INBOX",
              effort: "M15",
              roiScore: 3,
              frictionScore: 3,
              energyRequired: "MEDIUM",
              context: "ANYWHERE",
              finishCondition: "Fulfill commitment to contact",
              dueDate,
              loopKind: "ONCE",
              promiseTo: contact.name,
              createdBy: "inbound-crm",
            },
          });
          tasksCreated++;
        }
      }
    }

    return {
      ok: true,
      contactId: contact.id,
      contactName: contact.name,
      tasksCreated,
    };
  },
  { auth: "none" }
);
