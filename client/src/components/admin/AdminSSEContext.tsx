/**
 * AdminSSEContext — single shared SSE connection for the admin shell.
 *
 * v1.7 audit follow-up. Pre-fix:
 *   - Admin.tsx opened EventSource("/api/admin/events") (line ~189)
 *   - ActivityPulse.tsx opened ANOTHER EventSource("/api/admin/events")
 *     to the same endpoint (line 107)
 *   = two SSE connections per admin user, doubling server connection
 *     load (SSE connections are typically held open indefinitely).
 *
 * Now: a single EventSource is owned by AdminSSEProvider and exposed
 * via React context. Both consumers attach their own listeners to the
 * shared connection. Multiple listeners on the same EventSource for
 * the same event type all fire — no behavior loss.
 *
 * Listener registration helper:
 *   useAdminSSE() returns the EventSource | null.
 *   Consumers add their own .addEventListener(...) inside their
 *   own useEffect, returning a cleanup that removes it. Pattern is
 *   the same as before, just on a shared instance.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const AdminSSEContext = createContext<EventSource | null>(null);

export function AdminSSEProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const [es, setEs] = useState<EventSource | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEs(null);
      return;
    }
    let source: EventSource | null = null;
    try {
      source = new EventSource("/api/admin/events");
      setEs(source);
    } catch {
      // SSE not supported / blocked — leave context null, consumers
      // gracefully handle the absence.
    }
    return () => {
      source?.close();
      setEs(null);
    };
  }, [enabled]);

  return (
    <AdminSSEContext.Provider value={es}>{children}</AdminSSEContext.Provider>
  );
}

export function useAdminSSE(): EventSource | null {
  return useContext(AdminSSEContext);
}
