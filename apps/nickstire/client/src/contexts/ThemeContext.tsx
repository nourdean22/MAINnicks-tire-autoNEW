import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
  /** Admin: force the dark class while true, without changing or storing the visitor's theme. */
  setForcedDark: (on: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    // v1.7 audit fix · pre-fix called localStorage.getItem in the
    // useState lazy initializer. SSR / test environments throw
    // ReferenceError. Now guarded with typeof window check.
    if (switchable && typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem("theme");
        return (stored as Theme) || defaultTheme;
      } catch {
        // ignore — storage disabled / quota
      }
    }
    return defaultTheme;
  });
  // The admin (graphite only) forces dark while it is mounted; the visitor's theme is left alone.
  const [forcedDark, setForcedDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    if (forcedDark || theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, forcedDark, switchable]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable, setForcedDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** The provider's forced-dark switch, or undefined outside a ThemeProvider. */
export function useSetForcedDark() {
  return useContext(ThemeContext)?.setForcedDark;
}
