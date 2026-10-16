import { useEffect } from "react";
import { useSetForcedDark } from "@/contexts/ThemeContext";

/**
 * The admin is graphite only (Admin UI v1 W1) and has no theme toggle, but ThemeProvider applies the
 * visitor's stored theme to <html>. While the admin is mounted it asks the provider to force dark;
 * the provider owns the class, so its own apply effect cannot undo this on a direct /admin load, and
 * leaving the admin restores exactly the visitor's theme (localStorage is never touched).
 */
export function useAdminDarkClass() {
  const setForcedDark = useSetForcedDark();
  useEffect(() => {
    if (!setForcedDark) return;
    setForcedDark(true);
    return () => setForcedDark(false);
  }, [setForcedDark]);
}
