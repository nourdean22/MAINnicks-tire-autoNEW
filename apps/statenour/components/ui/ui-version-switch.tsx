"use client";

/**
 * UI version switch · migration infrastructure for the v2 cockpit (2026-10-01).
 *
 * `?ui=v1` or `?ui=v2` on any URL writes the `statenour_ui` cookie, stamps
 * `<html data-ui>` immediately, strips the param and reloads so the server-
 * rendered attribute (app/layout.tsx) agrees with the cookie. The stylesheets
 * key the old grammar off `:root[data-ui="v1"]` (tokens.css, base.css), so the
 * two generations can be screenshotted side by side on the same deployment.
 *
 * Not a user preference and not a second design system: delete the cookie
 * read, this component and the `[data-ui="v1"]` blocks once v2 is accepted.
 */

import { useEffect } from "react";

export const UI_VERSION_COOKIE = "statenour_ui";

export function UiVersionSwitch() {
  useEffect(() => {
    const url = new URL(window.location.href);
    const wanted = url.searchParams.get("ui");
    if (wanted !== "v1" && wanted !== "v2") return;
    document.cookie = `${UI_VERSION_COOKIE}=${wanted}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.dataset.ui = wanted;
    url.searchParams.delete("ui");
    window.location.replace(url.toString());
  }, []);
  return null;
}
