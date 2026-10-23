/**
 * WaitingOnUs - how many customers are waiting on a human reply, for the
 * Messages header.
 *
 * Reads smsConversations.humanPendingSummary (sms_response_jobs human_pending),
 * the same count Today and the morning brief use. It replaces a sum of
 * sms_conversations.unreadCount that read 129 while the real number was 1:
 * opening a thread clears unread, the crew answers by phone, and so the sum
 * never fell. The dot on each thread in the list is a separate signal and stays.
 *
 * Three states, never two. The server THROWS when it cannot count, so an error
 * is UNKNOWN. A paused query (offline PWA) has no data and no error and is
 * UNKNOWN too. Zero is shown only after a successful read of zero. An error
 * wins over an older count: a stale "1" beside a failed refresh is a guess.
 */
import { trpc } from "@/lib/trpc";

export default function WaitingOnUs() {
  const { data, isLoading, isError } = trpc.smsConversations.humanPendingSummary.useQuery(undefined, {
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
  });

  if (isLoading) return <p className="text-xs text-foreground/60 mt-0.5">Checking who is waiting…</p>;

  if (isError || data === undefined) {
    return (
      <p className="text-xs text-amber-400 font-medium mt-0.5">
        Waiting on us: unknown. The count could not be read, so check the threads.
      </p>
    );
  }

  if (data.humanPending === 0) return <p className="text-xs text-foreground/60 mt-0.5">None waiting on us</p>;

  return (
    <p className="text-xs text-primary font-medium mt-0.5">
      {data.humanPending} waiting on us{data.overdue > 0 ? `, ${data.overdue} overdue` : ""}
    </p>
  );
}
