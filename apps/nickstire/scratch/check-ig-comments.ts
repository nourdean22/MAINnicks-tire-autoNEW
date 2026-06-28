import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

async function main() {
  const { getMediaComments } = await import("../server/services/metaSocial");

  const mediaId = "18140717812552747";
  console.log(`Fetching comments for media ID ${mediaId}...`);

  try {
    const res = await getMediaComments(mediaId);
    console.log("\n=== Instagram comments fetch result ===");
    console.log(JSON.stringify(res, null, 2));
  } catch (err) {
    console.error("Error fetching comments:", err);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
});
