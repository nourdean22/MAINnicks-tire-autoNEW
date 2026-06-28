import { prisma } from '@/lib/prisma';
import { sendTelegram } from '@/lib/services/telegram';
import { creditStatXp } from '@/lib/mastery/credit';

/**
 * Calculates XP rewarded for waiting out a dependency or blocker.
 * Max 50 XP.
 * @param enteredWaitingAt The time the task or mission was blocked.
 */
export function calculatePatienceXP(enteredWaitingAt: Date): number {
  const hours = (Date.now() - enteredWaitingAt.getTime()) / 3600000;
  return Math.min(Math.floor(hours * 0.5), 50); // Cap at 50 XP
}

/**
 * Awards Patience XP when a task successfully leaves the WAITING state.
 * Automatically wires to the MIND domain ledger and alerts via Telegram.
 * 
 * @param taskId The task ID that was waiting
 * @param enteredWaitingAt The timestamp it entered WAITING state
 */
export async function awardPatienceXP(taskId: string, enteredWaitingAt: Date) {
  const xp = calculatePatienceXP(enteredWaitingAt);
  if (xp <= 0) return;

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: { mission: true }
  });

  if (!task) return;

  // Wires this to the operator's MIND domain via the mastery leveling engine
  await creditStatXp({
    stat: 'patience', // The specific stat key within the MIND branch
    xp: xp,
    signal: 'task',
    evidence: `Patience XP for waiting on task: ${task.title}`,
    sourceKey: `task-patience:${taskId}`
  });

  await sendTelegram(
    `🧘 *PATIENCE REWARDED*\n\nTask: ${task.title}\nWaited for: ${((Date.now() - enteredWaitingAt.getTime()) / 3600000).toFixed(1)}h\nReward: +${xp} MIND XP`
  );
}
