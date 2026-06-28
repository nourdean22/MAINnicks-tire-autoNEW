'use client';

import { Domain } from './VelocityRibbon';

export interface ActionReceipt {
  id: string;
  sourceSystem: string;
  domain: Domain;
  xpAwarded: number;
  executedAt: Date;
}

interface ActionReceiptGeneratorProps {
  onFireReceipt: (receipt: ActionReceipt) => void;
  simulatedTime: Date;
}

export function ActionReceiptGenerator({ onFireReceipt, simulatedTime }: ActionReceiptGeneratorProps) {
  const sources = [
    { name: 'Vapi Call', domain: 'BUSINESS' as Domain, xp: 25, icon: '📞' },
    { name: 'GitHub Push', domain: 'BUSINESS' as Domain, xp: 40, icon: '💻' },
    { name: 'Stripe Payment', domain: 'BUSINESS' as Domain, xp: 50, icon: '💳' },
    { name: 'Gym Log', domain: 'HEALTH' as Domain, xp: 45, icon: '🏋️' },
    { name: 'Meditation App', domain: 'MIND' as Domain, xp: 20, icon: '🧘' },
    { name: 'Journal Entry', domain: 'PERSONAL' as Domain, xp: 15, icon: '📓' },
  ];

  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-lg font-bold">Action Receipt Simulator</h3>
        <span className="text-xs px-2 py-1 bg-blue-500/20 text-blue-400 rounded uppercase font-bold tracking-widest">Incoming Webooks</span>
      </div>
      <p className="text-sm text-white/50 mb-6">
        Simulate external systems firing action receipts. This proves execution and auto-clears neglect states.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {sources.map((src, i) => (
          <button
            key={i}
            onClick={() => onFireReceipt({
              id: Math.random().toString(36).substring(7),
              sourceSystem: src.name,
              domain: src.domain,
              xpAwarded: src.xp,
              executedAt: new Date(simulatedTime)
            })}
            className="flex flex-col items-center justify-center gap-2 bg-black/40 hover:bg-white/10 border border-white/5 rounded-lg p-4 transition-transform active:scale-95"
          >
            <span className="text-2xl">{src.icon}</span>
            <span className="text-xs font-bold text-center">{src.name}</span>
            <span className="text-[10px] text-white/50 uppercase tracking-wider">+{src.xp} XP</span>
          </button>
        ))}
      </div>
    </div>
  );
}
