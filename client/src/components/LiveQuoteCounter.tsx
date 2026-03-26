import { useState, useEffect } from "react";

export default function LiveQuoteCounter() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const fetchCount = async () => {
      try {
        const res = await fetch("https://autonicks.com/api/quotes?countOnly=true");
        const data = await res.json();
        setCount(data?.data?.todayCount ?? data?.todayCount ?? 0);
      } catch {
        setCount(null);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 60000); // refresh every minute
    return () => clearInterval(interval);
  }, []);

  if (count === null || count === 0) return null;

  return (
    <div className="flex items-center gap-2 bg-[#1A1A1A] border border-[#2A2A2A] rounded-full px-4 py-2 text-sm">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
      </span>
      <span className="text-[#A0A0A0]">
        <span className="text-white font-semibold">{count}</span> quotes generated today
      </span>
    </div>
  );
}
