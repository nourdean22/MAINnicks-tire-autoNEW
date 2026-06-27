import dotenv from "dotenv";
import { resolve } from "path";

dotenv.config({ path: resolve("c:/Users/nourd/NOURCITY/apps/nickstire/.env") });

async function main() {
  console.log("Loading gatewayClient module...");
  const { searchTiresBySize, getLastGatewayFailure } = await import("../server/services/gatewayClient");

  const size = "215/60R16";
  console.log(`Running live search for tire size: "${size}"...`);

  try {
    const results = await searchTiresBySize(size);

    if (results) {
      console.log(`\n=== LIVE SEARCH SUCCESS: Found ${results.length} offers ===`);
      if (results.length > 0) {
        console.log("First offer preview:");
        const offer = results[0];
        console.log(JSON.stringify({
          brand: offer.brand,
          model: offer.model,
          partNumber: offer.dk_part_number,
          size: offer.size,
          price: offer.price,
          pricingData: offer.pricing_data
        }, null, 2));
      }
    } else {
      console.error("\n=== LIVE SEARCH FAILED ===");
      console.error(JSON.stringify(getLastGatewayFailure(), null, 2));
    }
  } catch (err) {
    console.error("Fatal error during search execution:", err);
  }
}

main().catch(console.error);
