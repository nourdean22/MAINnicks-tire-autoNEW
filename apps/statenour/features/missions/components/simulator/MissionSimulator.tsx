'use client';

import { useState, useEffect, useMemo } from 'react';
import { RescueStrip } from './RescueStrip';
import { VelocityRibbon, Domain, DOMAIN_COLORS } from './VelocityRibbon';
import { cn } from './VelocityRibbon';
import { trpc } from '@/lib/trpc/client';
import type { ActionReceipt } from '@/lib/ai/receipts/action-receipt';

interface SimulatedMission {
  id: string;
  title: string;
  domain: Domain;
  status: 'TODO' | 'IN_PROGRESS' | 'WAITING' | 'DONE';
  updatedAt: Date;
  enteredWaitingAt?: Date;
}

export function MissionSimulator() {
  const [baseTime] = useState(new Date());
  // Time offset in hours from the base time
  const [timeOffsetHours, setTimeOffsetHours] = useState(0);
  
  const simulatedTime = useMemo(() => new Date(baseTime.getTime() + timeOffsetHours * 3600000), [baseTime, timeOffsetHours]);

  // 1. Fetch real missions
  const { data: missionsRaw = [], isLoading: isMissionsLoading } = trpc.task.missions.useQuery();
  
  // 2. Fetch real system action receipts
  const { data: receiptFeed, isLoading: isReceiptsLoading } = trpc.system.receiptFeed.useQuery();

  const missions = useMemo<SimulatedMission[]>(() => {
    return missionsRaw.map(m => ({
      id: m.id,
      title: m.title,
      domain: (m.domain || 'BUSINESS').toUpperCase() as Domain,
      status: m.status as 'TODO' | 'IN_PROGRESS' | 'WAITING' | 'DONE',
      updatedAt: new Date(m.updatedAt),
      // Use updatedAt as a proxy for enteredWaitingAt since the field doesn't exist yet
      enteredWaitingAt: m.status === 'WAITING' ? new Date(m.updatedAt) : undefined,
    }));
  }, [missionsRaw]);

  // Derived state for the Velocity Ribbon (last 7 simulated days)
  const [weekData, setWeekData] = useState<Record<Domain, number>[]>(
    Array(7).fill({})
  );

  useEffect(() => {
    // Recalculate week data based on live receipts
    const newWeekData = Array(7).fill(null).map(() => ({} as Record<Domain, number>));
    const now = simulatedTime.getTime();
    const dayMs = 24 * 3600 * 1000;
    
    const receipts = receiptFeed?.items || [];

    receipts.forEach((receipt: ActionReceipt) => {
      const executedAt = new Date(receipt.createdAt);
      const daysAgo = Math.floor((now - executedAt.getTime()) / dayMs);
      
      if (daysAgo >= 0 && daysAgo < 7) {
        const dayIdx = 6 - daysAgo; // 0 = 6 days ago, 6 = today
        // We'll guess the domain or default to BUSINESS if unknown. 
        // In a real system, the receipt would have a canonical domain.
        const domain = 'BUSINESS' as Domain; 
        
        if (!newWeekData[dayIdx][domain]) {
          newWeekData[dayIdx][domain] = 0;
        }
        // Give 10 XP per action receipt since we don't have exact XP stored yet
        newWeekData[dayIdx][domain] += 10;
      }
    });
    queueMicrotask(() => {
      setWeekData(newWeekData);
    });
  }, [receiptFeed, simulatedTime]);

  const getIdleHours = (mission: SimulatedMission) => {
    return (simulatedTime.getTime() - mission.updatedAt.getTime()) / 3600000;
  };

  const getWaitingXP = (mission: SimulatedMission) => {
    if (mission.status !== 'WAITING' || !mission.enteredWaitingAt) return 0;
    const hoursWaiting = (simulatedTime.getTime() - mission.enteredWaitingAt.getTime()) / 3600000;
    return Math.max(0, Math.min(hoursWaiting * 0.5, 24)); // Capped at 24 XP
  };

  // Find the max neglected mission to show in the Rescue Strip
  const maxIdleMission = [...missions].sort((a, b) => getIdleHours(b) - getIdleHours(a))[0];
  const maxIdleHours = maxIdleMission ? Math.max(0, getIdleHours(maxIdleMission)) : 0;

  if (isMissionsLoading || isReceiptsLoading) {
    return <div className="p-8 text-white/50 animate-pulse font-mono uppercase tracking-widest text-sm">Initializing Systemic Engine...</div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-black text-white selection:bg-white/20 pb-20">
      <RescueStrip idleHours={maxIdleHours} />

      <main className="max-w-4xl mx-auto w-full p-4 md:p-8 flex flex-col gap-8">
        
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl md:text-4xl font-black tracking-tighter">Systemic Engine Simulator</h1>
          <p className="text-white/50 text-sm md:text-base">
            Live system data powering the math for Neglect Penalties and Patience XP. Use the scrubber to forecast the future.
          </p>
        </header>

        {/* Time Scrubber */}
        <section className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold">Time Scrubber</h2>
            <div className="text-right">
              <div className="text-sm text-white/50 uppercase tracking-widest font-bold">Simulated Time</div>
              <div className="text-lg font-mono">{simulatedTime.toLocaleString()}</div>
            </div>
          </div>
          
          <input 
            type="range" 
            min="0" 
            max="120" 
            value={timeOffsetHours} 
            onChange={(e) => setTimeOffsetHours(Number(e.target.value))}
            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white"
            title="Time Scrubber"
          />
          <div className="flex justify-between text-xs text-white/40 font-bold uppercase tracking-wider mt-2">
            <span>Now</span>
            <span>+48h (Danger)</span>
            <span>+120h (Decay)</span>
          </div>
        </section>

        {/* Velocity Ribbon */}
        <section>
          <h2 className="text-lg font-bold mb-3 uppercase tracking-widest text-white/50">Velocity Ribbon (Live Action Receipts)</h2>
          <VelocityRibbon weekData={weekData} />
        </section>

        {/* Active Missions */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold uppercase tracking-widest text-white/50">Live Missions</h2>
            <div className="text-xs font-mono bg-white/10 px-2 py-1 rounded text-white/70">
              {missions.length} active
            </div>
          </div>
          <div className="grid gap-4">
            {missions.length === 0 ? (
              <div className="p-8 border border-white/10 rounded-xl text-center text-white/40 uppercase font-bold tracking-widest text-sm">
                No active missions
              </div>
            ) : missions.map(mission => {
              const idleHours = getIdleHours(mission);
              const waitingXp = getWaitingXP(mission);
              const isNeglected = idleHours > 48 && mission.status !== 'WAITING';

              return (
                <div key={mission.id} className={cn(
                  "flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl border transition-colors",
                  isNeglected ? "bg-yellow-500/10 border-yellow-500/30" : "bg-white/5 border-white/10",
                  mission.status === 'WAITING' ? "opacity-70" : ""
                )}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <div className={cn("w-2 h-2 rounded-full", DOMAIN_COLORS[mission.domain]?.split(' ')[0] || 'bg-white')} />
                      <span className="text-xs font-bold uppercase tracking-widest text-white/50">{mission.domain}</span>
                    </div>
                    <h3 className="font-bold text-lg">{mission.title}</h3>
                    <div className="text-xs text-white/40 font-mono">
                      Status: {mission.status} | Updated: {mission.updatedAt.toLocaleTimeString()}
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    {mission.status === 'WAITING' ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-bold uppercase tracking-widest text-emerald-400">Patience XP</span>
                        <span className="font-mono text-lg text-emerald-300">+{waitingXp.toFixed(1)}</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-end">
                        <span className={cn(
                          "text-xs font-bold uppercase tracking-widest",
                          isNeglected ? "text-yellow-400" : "text-white/40"
                        )}>
                          Idle Time
                        </span>
                        <span className={cn(
                          "font-mono text-lg",
                          isNeglected ? "text-yellow-400" : "text-white/70"
                        )}>
                          {idleHours.toFixed(1)}h
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

      </main>
    </div>
  );
}

