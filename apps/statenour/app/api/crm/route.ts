import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

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

/**
 * POST /api/crm
 * Owner-gated manual contact creation from the CRM cockpit form.
 * Session-authenticated — replaces the old client-side call to the inbound-CRM
 * webhook (which leaked a shared secret in the browser and rejected with 401).
 */
export const POST = apiHandler(
  async (req) => {
    let payload: { name?: string; email?: string; phone?: string; role?: string };
    try {
      payload = await req.json();
    } catch {
      throw new ServiceError("Invalid JSON body", 400);
    }

    const name = payload.name?.trim();
    if (!name) {
      throw new ServiceError("Name is required", 400);
    }

    // email/phone are @unique — surface a clean 409 instead of a raw P2002/500.
    let contact;
    try {
      contact = await prisma.contact.create({
        data: {
          name,
          email: payload.email?.trim() || null,
          phone: payload.phone?.trim() || null,
          role: payload.role?.trim() || "lead",
          status: "active",
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") {
        throw new ServiceError("A contact with this email or phone already exists.", 409);
      }
      throw err;
    }

    return { contact };
  },
  { auth: "owner" }
);
