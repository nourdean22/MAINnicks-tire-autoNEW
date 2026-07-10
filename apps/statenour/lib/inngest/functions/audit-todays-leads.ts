import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("inngest/audit-todays-leads");
const inngest = getInngest();

export interface LeadsAuditResult {
  leadsProcessed: number;
  draftsCreated: number;
  timeline: string[];
}

export async function auditTodaysLeadsHandler({ step }: { step: any }) {
    // Step 1: Fetch active leads from nickstire.org via cross-app client
    const leads = await step.run("get-active-leads", async () => {
      const { callNickstire } = await import("@/lib/ai/agent-actions/shop-actions");
      const res = (await callNickstire("lead.list", { limit: 20 })) as any;
      if (res && res.result && Array.isArray(res.result.json)) {
        return {
          leads: res.result.json.map((l: any) => ({
            id: String(l.id),
            name: l.name || "Customer",
            phone: l.phone || "",
            status: l.status || "NEW",
            createdAt: l.createdAt ? new Date(l.createdAt).getTime() : Date.now(),
            lastContactedAt: l.lastContactedAt ? new Date(l.lastContactedAt).getTime() : null,
            vehicle: l.vehicle || "Vehicle",
          })),
          source: "success" as const,
        };
      }
      return {
        leads: [],
        source: "bridge_unavailable" as const,
      };
    });

    // Step 2 & 3: Run CRM Enrichment & Determine Outreach Priority
    const processedLeads = await step.run("enrich-and-score-leads", async () => {
      if (leads.source === "bridge_unavailable") return [];
      const enriched = [];
      const now = Date.now();

      for (const lead of leads.leads) {
        // Only audit new/uncontacted leads
        if (lead.status === "NEW") {
          const ageMs = now - lead.createdAt;
          const ageHours = Math.floor(ageMs / (3600 * 1000));
          
          let priority = "LOW";
          if (ageHours > 8) {
            priority = "HIGH";
          } else if (ageHours > 4) {
            priority = "MEDIUM";
          }

          enriched.push({
            ...lead,
            ageHours,
            priority,
          });
        }
      }
      return enriched;
    });

    // Step 4 & 5: Draft SMS & Queue Approval
    const drafts = await step.run("draft-and-queue-approvals", async () => {
      const { prisma } = await import("@/lib/prisma");
      let count = 0;
      const timeline: string[] = [];

      for (const lead of processedLeads) {
        // Skip leads without a valid phone number
        if (!lead.phone || lead.phone === "") continue;

        // Draft SMS message context
        const draftMessage = `Hi ${lead.name}, this is Nick from Nick's Tire & Auto. We saw your inquiry for the ${lead.vehicle}. Do you have any questions or would you like to get booked in?`;
        const reason = `Priority ${lead.priority} follow-up for new lead ${lead.name} (${lead.vehicle}) submitted ${lead.ageHours} hours ago.`;

        // Check if there is already an active pending approval for this lead
        const existing = await prisma.approvalRequest.findFirst({
          where: {
            toolId: "shop.sendSms",
            status: "pending_approval",
            payload: {
              path: ["phone"],
              equals: lead.phone,
            },
          },
        });

        if (!existing) {
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);

          await prisma.approvalRequest.create({
            data: {
              toolId: "shop.sendSms",
              actionType: "require_approval",
              status: "pending_approval",
              riskClass: "high",
              payload: {
                phone: lead.phone,
                message: draftMessage,
              },
              requestedBy: "workflow:audit-leads",
              reason,
              expiresAt,
            },
          });
          count++;
          timeline.push(`Created approval request for ${lead.name} (${lead.priority} priority).`);
        } else {
          timeline.push(`Approval request already exists for ${lead.name}, skipping.`);
        }
      }

      return {
        draftsCreated: count,
        timeline,
      };
    });

    log.info("leads_audit_complete", {
      processed: processedLeads.length,
      draftsCreated: drafts.draftsCreated,
    });

    return {
      leadsProcessed: processedLeads.length,
      draftsCreated: drafts.draftsCreated,
      timeline: drafts.timeline,
    };
  }

export const auditTodaysLeads = inngest.createFunction(
  {
    id: "audit-todays-leads",
    name: "Audit Today's Leads Workflow",
    retries: 1,
    triggers: [{ cron: "0 8 * * *" }], // Run every day at 8 AM
    onFailure: onInngestFailure,
  },
  auditTodaysLeadsHandler
);
