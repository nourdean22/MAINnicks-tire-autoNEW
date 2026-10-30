import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const getDbMock = vi.fn();

vi.mock("./db", () => ({
  getDb: getDbMock,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

function dbReturning(rows: any[]) {
  return {
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          leftJoin: () => ({
            where: () => ({
              orderBy: () => ({
                limit: async () => rows,
              }),
            }),
          }),
        }),
      }),
    }),
  } as any;
}

describe("public Instagram feed survives a fresh Railway container", () => {
  beforeEach(() => {
    getDbMock.mockReset();
  });

  it("falls back to durable publication + analytics rows when instagram-cache.json is absent", async () => {
    getDbMock.mockResolvedValue(dbReturning([
      {
        inventoryId: "autopost-2026-09-27",
        contentType: "reel",
        hookText: "Road-trip checklist",
        bodyText: "",
        assetPaths: ["https://nickstire.org/generated/reels/reel-1920013.mp4"],
        publishedAt: new Date("2026-09-27T08:04:26.000Z"),
        igPostId: "18435703312179867",
        caption: "Most road-trip breakdowns start as a ten-minute check somebody skipped.",
        postType: "VIDEO",
        postedAt: "2026-09-27T04:04:53+0000",
        likes: 2,
        comments: 0,
        mediaProductType: "REELS",
      },
    ]));

    const { getInstagramPosts } = await import("./instagram");
    const posts = await getInstagramPosts(3);

    expect(posts).toEqual([
      expect.objectContaining({
        id: "18435703312179867",
        type: "VIDEO",
        mediaUrl: "https://nickstire.org/generated/reels/reel-1920013.mp4",
        mediaProductType: "REELS",
        likes: 2,
        comments: 0,
      }),
    ]);
    expect(posts[0].link).toBe("https://www.instagram.com/nicks_tire_euclid/");
  });
});

describe("homepage social-proof renderer", () => {
  // Intent kept: a durable Reel MP4 is never put in an <img> (a broken tile). Since 2026-10-30 the
  // strip renders a facade (thumbnail or placeholder plus a play badge), not a <video>: three
  // un-postered MP4s cost about 44 MB per homepage view (railway-audit). Behaviour is pinned in
  // client/src/__tests__/instagram-tile-facade.test.tsx; this guards the wiring from the server side.
  it("renders durable Reel MP4s through the facade, never as img or video", () => {
    // Comments stripped: a doc comment that says "never a <video>" must not satisfy or fail this.
    const code = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const home = code("client/src/pages/Home.tsx");
    expect(home).toContain("<InstagramTileMedia post={post} />");
    expect(home).not.toMatch(/<video\b/);
    const tile = code("client/src/components/InstagramTileMedia.tsx");
    expect(tile).toMatch(/VIDEO_FILE\.test\(post\.mediaUrl/);
    expect(tile).not.toMatch(/<video\b/);
  });
});
