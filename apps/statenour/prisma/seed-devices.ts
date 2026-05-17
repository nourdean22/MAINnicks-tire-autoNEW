import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEVICES = [
  // ── Tuya Devices ──
  {
    name: "DIY Controller",
    platform: "TUYA",
    platformDeviceId: "ebfd885cbae5a004e4qv1u",
    deviceType: "OTHER",
    location: "home",
    status: "ONLINE",
    metadata: { product: "Custom/DIY", activated: "2026-01-21" },
  },
  {
    name: "Nour Roomlock",
    platform: "TUYA",
    platformDeviceId: "eb1060lc4pfxtoh8",
    deviceType: "LOCK",
    location: "home-bedroom",
    status: "OFFLINE",
    metadata: { product: "Smart Lock", activated: "2026-01-17" },
  },
  {
    name: "Audio Speaker",
    platform: "TUYA",
    platformDeviceId: "eb060180d128b982c0ca54",
    deviceType: "SPEAKER",
    location: "home",
    status: "ONLINE",
    metadata: { product: "Audio/Speaker", activated: "2026-01-13" },
  },
  {
    name: "Water Heater",
    platform: "TUYA",
    platformDeviceId: "eba7126d5e511b6c4beqcl",
    deviceType: "HEATER",
    location: "home",
    status: "ONLINE",
    metadata: { product: "Water Heater", activated: "2026-01-13" },
  },
  {
    name: "TV Basement",
    platform: "TUYA",
    platformDeviceId: "eb6916ce4f9bcc288ecgi7",
    deviceType: "IR_REMOTE",
    location: "home-basement",
    status: "ONLINE",
    metadata: { product: "TV IR Control", activated: "2026-01-13" },
  },
  {
    name: "Smart Remote IR+RF",
    platform: "TUYA",
    platformDeviceId: "ebbbec9cd46a7c2dc2voos",
    deviceType: "IR_REMOTE",
    location: "home",
    status: "ONLINE",
    metadata: { product: "IR/RF Remote Pro CBU433/315Mhz", activated: "2026-01-13" },
  },
  {
    name: "E02F Device",
    platform: "TUYA",
    platformDeviceId: "eb356fhckgs5vwpd",
    deviceType: "OTHER",
    location: "home",
    status: "OFFLINE",
    metadata: { product: "E02F", activated: "2026-01-13" },
  },
  {
    name: "Basement Litter Box",
    platform: "TUYA",
    platformDeviceId: "eb556ffc99e5ab27f1srmr",
    deviceType: "APPLIANCE",
    location: "home-basement",
    status: "ONLINE",
    metadata: { product: "Smart Cat Litter Box ECO", activated: "2025-11-22" },
  },
  // ── Shop Cameras (V380) ──
  {
    name: "Shop Inside Camera",
    platform: "V380",
    platformDeviceId: "v380-shopinside",
    deviceType: "CAMERA",
    location: "shop",
    status: "ONLINE",
    metadata: { source: "V380", cameraId: "SHOPINSIDE" },
  },
  {
    name: "Shop Sign Camera",
    platform: "V380",
    platformDeviceId: "v380-shopsign",
    deviceType: "CAMERA",
    location: "shop",
    status: "ONLINE",
    metadata: { source: "V380", cameraId: "SHOPSIGN" },
  },
  {
    name: "V380 Main Camera",
    platform: "V380",
    platformDeviceId: "v380-main",
    deviceType: "CAMERA",
    location: "shop",
    status: "ONLINE",
    metadata: { source: "V380", cameraId: "v380-main" },
  },
];

async function main() {
  console.log("Seeding smart devices...");

  for (const d of DEVICES) {
    const device = await prisma.smartDevice.upsert({
      where: { platformDeviceId: d.platformDeviceId },
      create: d,
      update: { name: d.name, status: d.status, metadata: d.metadata },
    });
    console.log(`  ${device.status === "ONLINE" ? "✓" : "✗"} ${device.name} (${device.platform})`);
  }

  console.log(`\nDone. ${DEVICES.length} devices seeded.`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
