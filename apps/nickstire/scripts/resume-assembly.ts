import { getDb } from "../server/db";
import { reelJobs } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { processNextAssemblyJob } from "../server/services/reelPipeline";
import { publishToSocial } from "../server/services/socialPublish";
import { getInstagramPermalink } from "../server/services/metaSocial";

async function main() {
  const db = (await getDb())!;
  await db.update(reelJobs)
    .set({ status: "assets_ready", attempts: 0, error: null })
    .where(eq(reelJobs.id, 30008));
  
  console.log("Reset job 30008 to assets_ready. Running assembly...");
  process.env.REEL_GENERATION_ENABLED = "true";
  
  let success = false;
  for (let i = 0; i < 5; i++) {
    const res = await processNextAssemblyJob();
    if (res.status === "assembled") {
       success = true;
       break;
    }
    if (!res.processed) break;
  }
  
  if (success) {
    const job = (await db.select().from(reelJobs).where(eq(reelJobs.id, 30008)))[0];
    const brief = JSON.parse(job.payload);
    console.log("Publishing to IG...");
    const pubResult = await publishToSocial({
       platforms: ["instagram"],
       videoUrl: job.mp4Url!,
       caption: job.caption || brief.selectedCaption || "",
    });
    if (pubResult.igPostId) {
       const permalink = await getInstagramPermalink(pubResult.igPostId);
       console.log("PUBLISHED!", permalink);
       await db.update(reelJobs).set({ status: "published", igPermalink: permalink }).where(eq(reelJobs.id, 30008));
    } else {
       console.log("Publish failed", pubResult);
    }
  } else {
    console.log("Assembly still failed.");
  }
  process.exit(0);
}
main();
