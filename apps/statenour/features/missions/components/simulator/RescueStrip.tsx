'use client';

interface RescueStripProps {
  idleHours: number;
}

const IDLE_HOURS_THRESHOLD = 48;
const DECAY_MULTIPLIER = 1.5;

export function RescueStrip({ idleHours }: RescueStripProps) {
  const isNeglected = idleHours > IDLE_HOURS_THRESHOLD;
  const penaltyXP = isNeglected ? Math.floor((idleHours - IDLE_HOURS_THRESHOLD) * DECAY_MULTIPLIER) : 0;

  if (!isNeglected) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-between px-4 py-3 bg-yellow-400 text-black shadow-[0_0_20px_rgba(250,204,21,0.6)]">
      <div className="flex items-center gap-2">
        <span className="text-xl">🚨</span>
        <div>
          <p className="font-bold text-sm tracking-tight uppercase">High Neglect Warning</p>
          <p className="text-xs font-medium opacity-80">
            Action required. This mission has been idle for {Math.floor(idleHours)} hours.
          </p>
        </div>
      </div>
      
      <div className="flex flex-col items-end">
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black tracking-tighter">-{penaltyXP}</span>
          <span className="text-xs font-bold uppercase opacity-75">XP</span>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">Systemic Decay</span>
      </div>
    </div>
  );
}
