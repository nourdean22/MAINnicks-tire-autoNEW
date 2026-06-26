import "dotenv/config";
import { runManufacturingPipeline } from "./apps/nickstire/server/services/contentManufacturing";

async function run() {
  console.log("Running manufacturing pipeline test...");
  try {
    const res = await runManufacturingPipeline("test-campaign", "brake squeak causes", "cleveland_car_doctor", { limit: 1 });
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e);
  }
}
run();
