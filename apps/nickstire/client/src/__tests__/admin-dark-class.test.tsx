/**
 * Admin UI v1 W1: the admin is graphite only and has no theme toggle, but the app's ThemeProvider
 * applies the visitor's stored theme to <html>. useAdminDarkClass asks the provider to force dark
 * while the admin is mounted (setForcedDark) instead of editing the class itself, so the provider's
 * own apply effect can never undo it on a direct /admin load, leaving the admin never strips a dark
 * class the provider owns, and the stored theme in localStorage stays the visitor's choice.
 * Rendered inside the real ThemeProvider, the way App.tsx mounts it.
 */
import { afterEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { useAdminDarkClass } from "@/components/admin/useAdminDarkClass";

function AdminProbe() {
  useAdminDarkClass();
  return null;
}
const app = (adminMounted: boolean) => (
  <ThemeProvider defaultTheme="dark" switchable>
    {adminMounted ? <AdminProbe /> : null}
  </ThemeProvider>
);
const dark = () => document.documentElement.classList.contains("dark");

afterEach(() => {
  document.documentElement.className = "";
  window.localStorage.removeItem("theme");
});

describe("useAdminDarkClass inside the real ThemeProvider", () => {
  it("a stored light theme: dark while the admin is mounted, light again after, stored theme untouched", () => {
    window.localStorage.setItem("theme", "light");
    const { rerender } = render(app(true));
    expect(dark()).toBe(true);
    rerender(app(false));
    expect(dark()).toBe(false);
    expect(window.localStorage.getItem("theme")).toBe("light");
  });

  it("a stored dark theme stays dark after the admin unmounts", () => {
    window.localStorage.setItem("theme", "dark");
    const { rerender } = render(app(true));
    expect(dark()).toBe(true);
    rerender(app(false));
    expect(dark()).toBe(true);
    expect(window.localStorage.getItem("theme")).toBe("dark");
  });
});
