import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { calculateScoreboardStats } from "@/lib/brain/calibration-engine";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async () => {
    const pending = await prisma.calibrationReviewItem.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "desc" },
    });

    const history = await prisma.calibrationReviewItem.findMany({
      where: { status: { in: ["approved", "corrected", "rejected"] } },
      orderBy: { updatedAt: "desc" },
      take: 50,
    });

    const lessons = await prisma.brainMemory.findMany({
      where: {
        category: "prediction_lesson",
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    const scoreboard = await calculateScoreboardStats();

    return {
      pending,
      history,
      lessons,
      scoreboard,
    };
  },
  { auth: "owner" }
);
