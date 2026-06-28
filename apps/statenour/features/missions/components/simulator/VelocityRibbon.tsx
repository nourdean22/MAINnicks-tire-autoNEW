'use client';

import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// 6 Core Life Domains
export type Domain = 'HEALTH' | 'MIND' | 'BUSINESS' | 'SOCIAL' | 'SPIRITUAL' | 'PERSONAL';

export const DOMAIN_COLORS: Record<Domain, string> = {
  HEALTH: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]',
  MIND: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]',
  BUSINESS: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]',
  SOCIAL: 'bg-pink-500 shadow-[0_0_10px_rgba(236,72,153,0.5)]',
  SPIRITUAL: 'bg-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.5)]',
  PERSONAL: 'bg-zinc-100 shadow-[0_0_10px_rgba(244,244,245,0.5)]',
};

interface VelocityRibbonProps {
  // Array of 7 days, each containing a mapping of Domain -> XP
  weekData: Record<Domain, number>[];
}

export function VelocityRibbon({ weekData }: VelocityRibbonProps) {
  const domains: Domain[] = ['HEALTH', 'MIND', 'BUSINESS', 'SOCIAL', 'SPIRITUAL', 'PERSONAL'];
  const maxDailyXP = 100; // Normalizing value for the progress bars

  return (
    <div className="w-full bg-zinc-900/40 backdrop-blur-md rounded-xl p-4 border border-white/5">
      <div className="flex justify-between gap-2">
        {weekData.map((dayData, dayIdx) => (
          <div key={dayIdx} className="flex-1 flex flex-col gap-3">
            <div className="text-center text-xs font-bold text-white/50 uppercase tracking-widest">
              Day {dayIdx + 1}
            </div>
            
            <div className="flex flex-col gap-1 w-full">
              {domains.map((domain) => {
                const xp = dayData[domain] || 0;
                const percentage = Math.min(100, Math.max(0, (xp / maxDailyXP) * 100));
                
                return (
                  <div key={domain} className="h-1.5 w-full bg-black/50 rounded-full overflow-hidden relative">
                    <div
                      className={cn("absolute left-0 top-0 bottom-0 rounded-full transition-all duration-300", DOMAIN_COLORS[domain])}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4 justify-center">
         {domains.map(domain => (
           <div key={domain} className="flex items-center gap-1.5">
             <div className={cn("w-2 h-2 rounded-full", DOMAIN_COLORS[domain].split(' ')[0])} />
             <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{domain}</span>
           </div>
         ))}
      </div>
    </div>
  );
}
