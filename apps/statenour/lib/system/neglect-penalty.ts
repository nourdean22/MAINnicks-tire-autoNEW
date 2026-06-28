import { prisma } from '@/lib/prisma';
import { sendTelegram } from '@/lib/services/telegram';

const IDLE_HOURS_THRESHOLD = 48;
const DECAY_MULTIPLIER = 1.5;

/**
 * Runs periodically to deduct XP from neglected missions.
 */
export async function neglectPenaltyCron() {
  const thresholdDate = new Date(Date.now() - IDLE_HOURS_THRESHOLD * 3600000);

  const neglectedMissions = await prisma.mission.findMany({
    where: {
      status: { in: ['ACTIVE'] },
      updatedAt: { lt: thresholdDate }
    }
  });

  if (neglectedMissions.length === 0) return 0;

  let totalPenalties = 0;

  for (const mission of neglectedMissions) {
    const hoursIdle = (Date.now() - mission.updatedAt.getTime()) / 3600000;
    const penaltyAmount = Math.floor(Math.pow((hoursIdle - IDLE_HOURS_THRESHOLD) * DECAY_MULTIPLIER, 1.2));
    
    // We update the neglectCost metric
    await prisma.mission.update({
      where: { id: mission.id },
      data: {
        neglectCost: {
          increment: penaltyAmount
        }
      }
    });

    totalPenalties += penaltyAmount;

    // Send the alert
    if (penaltyAmount > 10) {
      await sendTelegram(
        `🚨 *NEGLECT PENALTY*\n\nMission: ${mission.title}\nIdle for: ${hoursIdle.toFixed(1)}h\nPenalty: -${penaltyAmount} XP\n\n_Systemic decay is ruthless._`
      );
    }
  }

  return totalPenalties;
}
