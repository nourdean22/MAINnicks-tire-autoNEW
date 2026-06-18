import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/crm
 * Returns aggregated CRM data (contacts, recent bookings, recent agreements)
 */
export const GET = apiHandler(
  async () => {
    const [contacts, recentBookings, recentAgreements] = await Promise.all([
      prisma.contact.findMany({
        orderBy: { updatedAt: "desc" },
        include: {
          bookings: { orderBy: { startTime: "desc" }, take: 3 },
          agreements: { orderBy: { createdAt: "desc" }, take: 3 },
        },
      }),
      prisma.booking.findMany({
        orderBy: { startTime: "desc" },
        include: { contact: true },
        take: 10,
      }),
      prisma.agreement.findMany({
        orderBy: { createdAt: "desc" },
        include: { contact: true },
        take: 10,
      }),
    ]);

    return {
      contacts,
      recentBookings,
      recentAgreements,
    };
  },
  { auth: "owner" }
);
