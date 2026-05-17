import { cn } from "@/lib/utils/cn";

export function Panel({
  children,
  className
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <section className={cn("panel rounded-[24px] p-4 md:p-5", className)}>{children}</section>;
}
