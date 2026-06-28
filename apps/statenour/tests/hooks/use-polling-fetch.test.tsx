import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { usePollingFetch } from "@/hooks/use-polling-fetch";

function Probe({ url, skip }: { url: string; skip?: boolean }) {
  const { data, loading } = usePollingFetch(url, { skip });
  return (
    <div
      data-data={JSON.stringify(data)}
      data-loading={String(loading)}
    />
  );
}

describe("usePollingFetch Hook", () => {
  it("defaults to loading=false when skip is true", () => {
    const markup = renderToStaticMarkup(<Probe url="/api/test" skip={true} />);
    expect(markup).toContain('data-loading="false"');
    expect(markup).toContain('data-data="null"');
  });

  it("defaults to loading=true when skip is false", () => {
    const markup = renderToStaticMarkup(<Probe url="/api/test" skip={false} />);
    expect(markup).toContain('data-loading="true"');
  });
});
