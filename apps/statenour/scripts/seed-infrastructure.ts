/**
 * Seed infrastructure data: integrations, settings, and automation rules.
 * Run with: npx tsx scripts/seed-infrastructure.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding infrastructure data...\n");

  // ── Integrations ──────────────────────────────────────────────────
  const integrations = [
    { name: "tuya", type: "api", status: "healthy", metadata: { deviceCount: 8, platform: "Tuya Cloud" } },
    { name: "ring", type: "api", status: "healthy", metadata: { deviceCount: 5, platform: "Ring Doorbell" } },
    { name: "v380", type: "api", status: "healthy", metadata: { deviceCount: 2, platform: "V380 Cloud P2P" } },
    { name: "eufy", type: "api", status: "degraded", metadata: { note: "Captcha pending", platform: "Eufy Security" } },
    { name: "neon-postgres", type: "api", status: "healthy", metadata: { region: "us-east-1", plan: "free" } },
    { name: "vercel", type: "api", status: "healthy", metadata: { plan: "hobby", domain: "autonicks.com" } },
  ];

  for (const intg of integrations) {
    await prisma.integration.upsert({
      where: { name: intg.name },
      create: intg as any,
      update: { status: intg.status, metadata: intg.metadata },
    });
    console.log(`  ✓ Integration: ${intg.name} (${intg.status})`);
  }

  // ── Settings ──────────────────────────────────────────────────────
  const settings = [
    { key: "ai.dailyBudgetCents", value: "500", type: "number", category: "ai" },
    { key: "notifications.email", value: "nourdean22@gmail.com", type: "string", category: "notifications" },
    { key: "notifications.channel", value: "telegram", type: "string", category: "notifications" },
    { key: "system.timezone", value: "America/New_York", type: "string", category: "system" },
    { key: "ui.density", value: "comfortable", type: "string", category: "ui" },
  ];

  for (const pref of settings) {
    await prisma.userPreference.upsert({
      where: { key: pref.key },
      create: pref,
      update: { value: pref.value },
    });
    console.log(`  ✓ Setting: ${pref.key} = ${pref.value}`);
  }

  // ── Automation Rules ──────────────────────────────────────────────
  const rules = [
    {
      name: "No leads in 24 hours",
      trigger: { type: "time", hour: 18, days: [1, 2, 3, 4, 5] },
      actions: [{ type: "notify", channel: "telegram", message: "No new leads today. Check lead sources." }],
      priority: 3,
      createdBy: "system",
      cooldownMs: 86400000,
    },
    {
      name: "Camera offline alert",
      trigger: { type: "device_state", condition: { status: "OFFLINE", deviceType: "CAMERA" } },
      actions: [{ type: "notify", channel: "telegram", message: "Camera went offline" }],
      priority: 2,
      createdBy: "system",
      cooldownMs: 3600000,
    },
    {
      name: "Low energy pattern detected",
      trigger: { type: "pattern", category: "pattern", key: "low_energy_trend", minConfidence: 0.5 },
      actions: [{ type: "notify", channel: "telegram", message: "Energy has been low recently. Consider adjusting schedule." }],
      priority: 5,
      createdBy: "brain",
      cooldownMs: 86400000,
    },
    {
      name: "Late night motion + lights off",
      trigger: { type: "composite", conditions: [
        { type: "time", hour: 23 },
        { type: "device_state", condition: { event: "motion_detected" } },
      ]},
      actions: [{ type: "notify", channel: "telegram", message: "Motion detected late at night with lights off." }],
      priority: 1,
      createdBy: "system",
      cooldownMs: 3600000,
    },
    {
      name: "Shop inactive during business hours",
      trigger: { type: "time", hour: 14, days: [1, 2, 3, 4, 5] },
      actions: [{ type: "check", target: "shop_cameras", message: "Check shop camera activity 10AM-2PM" }],
      priority: 4,
      createdBy: "system",
      cooldownMs: 86400000,
    },
    {
      name: "Device running 6+ hours",
      trigger: { type: "device_state", condition: { runningHours: 6 } },
      actions: [{ type: "notify", channel: "telegram", message: "A device has been running for 6+ hours. Check if intentional." }],
      priority: 5,
      createdBy: "system",
      cooldownMs: 21600000,
    },
    {
      name: "System disconnect warning",
      trigger: { type: "time", hour: 8 },
      actions: [{ type: "check", target: "device_commands", message: "No device commands in 48 hours — possible disconnect" }],
      priority: 3,
      createdBy: "system",
      cooldownMs: 172800000,
    },
    {
      name: "High drift risk task",
      trigger: { type: "pattern", category: "anomaly", key: "stale_task", minConfidence: 0.3 },
      actions: [{ type: "notify", channel: "telegram", message: "A task has high drift risk — not touched in 5+ days." }],
      priority: 3,
      createdBy: "brain",
      cooldownMs: 86400000,
    },
  ];

  for (const rule of rules) {
    const existing = await prisma.automationRule.findFirst({ where: { name: rule.name } });
    if (!existing) {
      await prisma.automationRule.create({
        data: {
          name: rule.name,
          trigger: rule.trigger as any,
          actions: rule.actions as any,
          priority: rule.priority,
          createdBy: rule.createdBy,
          cooldownMs: rule.cooldownMs,
          enabled: true,
        },
      });
      console.log(`  ✓ Rule: ${rule.name}`);
    } else {
      console.log(`  · Rule exists: ${rule.name}`);
    }
  }

  console.log("\n✅ Infrastructure seeded successfully!");
  console.log(`  Integrations: ${integrations.length}`);
  console.log(`  Settings: ${settings.length}`);
  console.log(`  Automation Rules: ${rules.length}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
