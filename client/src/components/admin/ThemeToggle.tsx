/**
 * ThemeToggle — dark/light switch for the admin shell.
 *
 * Uses the existing ThemeContext (switchable=true). Persists choice to
 * localStorage. Starts dark to match the shop's dim lighting, but the
 * operator can flip it when working outside in harsh daylight or from
 * a brighter indoor space.
 */

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

interface Props {
  className?: string;
}

export default function ThemeToggle({ className = "" }: Props) {
  const { theme, toggleTheme, switchable } = useTheme();
  if (!switchable || !toggleTheme) return null;

  const isDark = theme === "dark";
  return (
    <button
      onClick={toggleTheme}
      className={`inline-flex items-center justify-center w-9 h-9 rounded-lg border border-border/30 text-muted-foreground hover:text-foreground hover:border-border/60 active:scale-95 transition-all ${className}`}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
