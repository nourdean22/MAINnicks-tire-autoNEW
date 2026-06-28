async function main() {
  const username = "BY9G1A";
  const password = "5lhjcnqp-caenp";
  const targetDeviceId = "f_U1jrQBy_g8W-2pWz7g4";
  const baseUrl = "https://api.sms-gate.app/3rdparty/v1";
  const auth = Buffer.from(`${username}:${password}`).toString("base64");

  try {
    const res = await fetch(`${baseUrl}/device`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) {
      console.log("Device details fetch failed:", res.status, await res.text());
      return;
    }
    const devices = await res.json();
    console.log("Devices list on Capevace:");
    console.log(JSON.stringify(devices, null, 2));

    const dev = devices.find((d: any) => d.id === targetDeviceId);
    if (!dev) {
      console.log(`Device ${targetDeviceId} not found in the list!`);
      return;
    }

    const lastSeenMs = dev.lastSeen ? new Date(dev.lastSeen).getTime() : 0;
    const ageMin = lastSeenMs ? (Date.now() - lastSeenMs) / 60_000 : 999;
    console.log(`\nDevice ${targetDeviceId} Details:`);
    console.log(`- lastSeen: ${dev.lastSeen}`);
    console.log(`- ageMinutes: ${ageMin.toFixed(2)}`);
    console.log(`- isGatewayOnline: ${ageMin < 30}`);
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

main().then(() => process.exit(0));
