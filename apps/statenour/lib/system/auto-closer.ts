import { prisma } from '@/lib/prisma';
import { Prisma, type ActionReceipt } from '@prisma/client';

/**
 * Validates whether a mission can be closed based on its completion criteria and verified receipts.
 * @param missionId The ID of the mission to evaluate
 * @returns boolean indicating if it was successfully closed
 */
export async function evaluateMissionForAutoClose(missionId: string): Promise<boolean> {
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { actionReceipts: true }
  });

  if (!mission || mission.status === 'COMPLETE' || mission.status === 'KILLED') {
    return false;
  }

  // If no criteria, it cannot be auto-closed
  if (!mission.completionCriteria) {
    return false;
  }

  const criteria = mission.completionCriteria as { requiresSourceSystem?: string };
  const requiredSystem = criteria.requiresSourceSystem;

  if (requiredSystem) {
    // Check if we have a successful receipt from the required system
    const hasValidReceipt = mission.actionReceipts.some(
      (receipt: ActionReceipt) => receipt.sourceSystem === requiredSystem && receipt.status === 'SUCCESS'
    );

    if (hasValidReceipt) {
      await prisma.mission.update({
        where: { id: missionId },
        data: { 
          status: 'COMPLETE',
          updatedBy: 'system:auto-closer',
        }
      });
      return true;
    }
  }

  return false;
}

/**
 * Runs a global sweep to auto-close any eligible missions.
 * Useful for cron jobs.
 */
export async function runGlobalAutoCloseSweep() {
  const openMissions = await prisma.mission.findMany({
    where: { 
      status: { in: ['ACTIVE', 'PAUSED'] },
      completionCriteria: { not: Prisma.AnyNull }
    },
    select: { id: true }
  });

  let closedCount = 0;
  for (const m of openMissions) {
    const closed = await evaluateMissionForAutoClose(m.id);
    if (closed) closedCount++;
  }

  return closedCount;
}
