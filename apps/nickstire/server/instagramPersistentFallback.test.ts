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
  it("renders durable Reel MP4s as video rather than img", () => {
    const src = readFileSync(resolve(process.cwd(), "client/src/pages/Home.tsx"), "utf8");
    expect(src).toContain('const video = post.type === "VIDEO" ? post.mediaUrl : undefined;');
    expect(src).toContain("<video");
    expect(src).toContain('preload="metadata"');
    expect(src).toContain("poster={post.thumbnailUrl}");
  });
});
