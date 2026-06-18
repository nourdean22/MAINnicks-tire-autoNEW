import { getInngest } from "../client";
import { onInngestFailure } from "../on-failure";
import { prisma } from "@/lib/prisma";
import { sendTelegram } from "@/lib/services/telegram";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { logger } from "@/lib/logger";

const log = logger.withSurface("inngest/crm-followups");
const inngest = getInngest();

export const crmFollowups = inngest.createFunction(
  {
    id: "crm-weekly-followups",
    name: "CRM weekly client follow-ups",
    // Run every Monday at 9:00 AM UTC
    triggers: [{ cron: "0 9 * * 1" }],
    onFailure: onInngestFailure,
  },
  async ({ step }) => {
    // 1. Fetch active coaching clients and leads
    const contacts = await step.run("fetch-inactive-contacts", async () => {
      const allContacts = await prisma.contact.findMany({
        where: {
          role: { in: ["coaching_client", "lead"] },
          status: "active",
        },
        include: {
          bookings: {
            orderBy: { startTime: "desc" },
            take: 1,
          },
          agreements: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          orders: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      });

      const fourteenDaysAgo = new Date();
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);

      // Filter to find contacts who haven't had any activity in 14 days
      return allContacts.filter((contact) => {
        const dates: Date[] = [contact.updatedAt];

        if (contact.bookings[0]) dates.push(new Date(contact.bookings[0].startTime));
        if (contact.agreements[0]) dates.push(new Date(contact.agreements[0].createdAt));
        if (contact.orders[0]) dates.push(new Date(contact.orders[0].createdAt));

        const lastActivity = new Date(Math.max(...dates.map((d) => d.getTime())));
        return lastActivity < fourteenDaysAgo;
      });
    });

    log.info("found_inactive_contacts", { count: contacts.length });

    if (contacts.length === 0) {
      return { ok: true, processed: 0 };
    }

    const inboxMissionId = await step.run("resolve-inbox-mission", async () => {
      return resolveInboxMissionId();
    });

    // 2. Process follow-ups
    const results = await step.run("create-followup-tasks", async () => {
      let tasksCreated = 0;
      const contactNames: string[] = [];

      for (const contact of contacts) {
        // Check if there is already an active follow-up task for this client to prevent duplication
        const existingTask = await prisma.task.findFirst({
          where: {
            promiseTo: contact.name,
            title: { startsWith: "Follow up with client:" },
            status: { notIn: ["DONE", "ARCHIVED"] },
            deletedAt: null,
          },
        });

        if (!existingTask) {
          await prisma.task.create({
            data: {
              title: `Follow up with client: ${contact.name}`,
              nextPhysicalAction: `Send a check-in message to ${contact.name} (no activity in 14+ days)`,
              missionId: inboxMissionId,
              status: "READY",
              effort: "M15",
              roiScore: 4,
              frictionScore: 2,
              energyRequired: "LOW",
              context: "PHONE",
              finishCondition: "Message sent and logged",
              loopKind: "ONCE",
              promiseTo: contact.name,
            },
          });
          tasksCreated++;
          contactNames.push(contact.name);
        }
      }

      return { tasksCreated, contactNames };
    });

    // 3. Notify operator on Telegram
    if (results.tasksCreated > 0) {
      await step.run("send-telegram-notification", async () => {
        const message = `🤝 <b>CRM Follow-up Reminders</b>\n\nThe following clients have had no touchpoints in 14+ days. Follow-up tasks have been created in your Inbox:\n\n${results.contactNames
          .map((name) => `- ${name}`)
          .join("\n")}`;
        await sendTelegram(message);
      });
    }

    return {
      ok: true,
      processed: contacts.length,
      tasksCreated: results.tasksCreated,
    };
  }
);
