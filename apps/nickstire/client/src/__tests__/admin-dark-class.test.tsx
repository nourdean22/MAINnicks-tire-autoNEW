/**
 * Admin UI v1 W1: the admin is graphite only and its ThemeToggle is gone, but ThemeProvider still
 * restores localStorage.theme. An admin who once stored "light" would load the admin without the
 * `dark` class, switching every `dark:` variant off. useAdminDarkClass adds `dark` to <html> while
 * the admin is mounted and puts the previous state back when it unmounts (the public site keeps
 * whatever the visitor chose).
 */
import { afterEach, describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useAdminDarkClass } from "@/components/admin/useAdminDarkClass";

const root = () => document.documentElement.classList;
afterEach(() => {
  document.documentElement.className = "";
});

describe("useAdminDarkClass", () => {
  it("a stored light theme gets the dark class while the admin is mounted, and back to light after", () => {
    root().add("light");
    const { unmount } = renderHook(() => useAdminDarkClass());
    expect(root().contains("dark")).toBe(true);
    unmount();
    expect(root().contains("dark")).toBe(false);
    expect(root().contains("light")).toBe(true);
  });

  it("an already dark page stays dark after the admin unmounts", () => {
    root().add("dark");
    const { unmount } = renderHook(() => useAdminDarkClass());
    expect(root().contains("dark")).toBe(true);
    unmount();
    expect(root().contains("dark")).toBe(true);
  });
});
