/*
 * Hexabot — Fair Core License (FCL-1.0-ALv2)
 * Copyright (c) 2025 Hexastack.
 * Full terms: see LICENSE.md.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { config, type WidgetHandle } from "./index";

vi.mock("./ChatWidget", () => {
  return {
    default: () => <div data-testid="chat-widget" />,
  };
});

describe("imperative embed API", () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hb-chat-widget"></div>';
  });

  it("builds, hides, shows, and destroys the widget", async () => {
    const container = document.getElementById("hb-chat-widget")!;
    const embed: WidgetHandle = config({ id: container });

    expect(Object.keys(embed).sort()).toEqual(["destroy", "hide", "show"]);
    expect(container.innerHTML).toBe("");

    embed.show();
    await vi.waitFor(() => {
      expect(
        container.querySelector('[data-testid="chat-widget"]'),
      ).not.toBeNull();
    });

    embed.hide();
    expect(container.hidden).toBe(true);

    embed.show();
    expect(container.hidden).toBe(false);

    embed.destroy();
    expect(container.innerHTML).toBe("");
    expect(() => embed.destroy()).not.toThrow();
    expect(() => embed.show()).not.toThrow();
  });
});
