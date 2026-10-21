import { useEffect } from "react";
import { trpc } from "@/lib/trpc";

/**
 * SYNC ON A PAGE LOAD (Nour, 2026-10-21, "whenever i login or refresh the admin": "Refresh
 * syncs anytime"). Called by the admin SHELL once it is ready, so a refresh of any tab
 * (/admin?tab=revenue, /admin?tab=customers, ...) asks the server to sync ShopDriver. The
 * server throttles to one sync per 30 min at any hour and the shop counter is logged out each
 * time one runs, which Nour accepted.
 *
 * Once per DOCUMENT: the marker lives on `window`, so a tab change or an in-app return is not a
 * load and a browser refresh resets it (a test starts a new document by deleting it). It is
 * "pending" while the call is out, "done" only once the server ACCEPTED it, and cleared when the
 * call is rejected: with MFA on, adminProcedure refuses the first call, and a marker set before
 * the answer would swallow the only sync of the load. A shell that stays mounted after MFA
 * clears does not retry by itself; the next load does.
 *
 * After an accepted call the Billed card is re-read once: the answer carries `syncInFlight`, and
 * the card follows the probe from there. The shell never shows a number itself.
 */
const MARK = "__adminLoadSyncAsked";
type Mark = "pending" | "done";
const marks = () => window as unknown as Record<string, Mark | undefined>;

export function useSyncOnAdminLoad(adminReady: boolean): void {
  const utils = trpc.useUtils();
  const { mutate: syncOnLoad } = trpc.shopdriver.syncOnAdminLoad.useMutation({
    onSuccess: () => {
      marks()[MARK] = "done";
      void utils.controlCenter.shopSales.invalidate();
    },
    onError: () => {
      delete marks()[MARK];
    },
  });
  useEffect(() => {
    if (!adminReady || marks()[MARK]) return;
    marks()[MARK] = "pending";
    syncOnLoad();
  }, [adminReady, syncOnLoad]);
}
