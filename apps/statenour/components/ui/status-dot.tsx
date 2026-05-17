import { cn } from '@/lib/utils';

type StatusColor = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

export function StatusDot({ color, className }: { color: StatusColor; className?: string }) {
  return <span className={cn('status-dot', `status-dot-${color}`, className)} />;
}
