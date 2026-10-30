import { CalendarDays } from "lucide-react";
import { OPEN_INTERVIEWS_LINE } from "@shared/jobOpenings";

/** The owner's walk-in interview hours, shown on /careers and every job page. */
export default function OpenInterviewsNote({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl border border-nick-yellow/30 bg-nick-yellow/5 p-4 ${className}`}>
      <CalendarDays className="w-4 h-4 text-nick-yellow shrink-0 mt-0.5" />
      <p className="text-[14px] leading-relaxed text-foreground/85">{OPEN_INTERVIEWS_LINE}</p>
    </div>
  );
}
