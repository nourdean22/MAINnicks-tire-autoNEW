/**
 * The link to one journal entry (W8b). `?entry=` is what lands on it: the feed holds only the newest page, so
 * /journal reads that entry by id (components/journal/linked-entry.tsx). The hash stays for the chat's page context.
 */
export function journalEntryHref(id: string): string {
  return `/journal?entry=${encodeURIComponent(id)}#bd-${id}`;
}
