import { useEffect } from "react";

/**
 * The admin is graphite only (Admin UI v1 W1) and has no theme toggle, but ThemeProvider still
 * restores localStorage.theme, so an admin who once stored "light" would lose every `dark:` variant.
 * While the admin is mounted, <html> carries `dark`; on unmount the previous state comes back, so the
 * public site keeps whatever the visitor chose.
 */
export function useAdminDarkClass() {
  useEffect(() => {
    const root = document.documentElement;
    const hadDark = root.classList.contains("dark");
    root.classList.add("dark");
    return () => {
      if (!hadDark) root.classList.remove("dark");
    };
  }, []);
}
