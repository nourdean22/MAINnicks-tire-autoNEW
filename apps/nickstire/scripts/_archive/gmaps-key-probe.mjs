// Probe the Google Maps API key against every common Google Maps service.
// Tells us whether the key is alive, and which APIs it can/can't hit.

import 'dotenv/config';
import https from 'node:https';

const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
const mapsKey = process.env.GOOGLE_MAPS_API_KEY;
const placesKey = process.env.GOOGLE_PLACES_API_KEY;

console.log('=== Key probe ===');
console.log('GOOGLE_PLACES_API_KEY:', placesKey ? placesKey.slice(0, 10) + '...' + placesKey.slice(-4) : '(not set)');
console.log('GOOGLE_MAPS_API_KEY:  ', mapsKey ? mapsKey.slice(0, 10) + '...' + mapsKey.slice(-4) : '(not set)');
console.log('Same key?             ', placesKey === mapsKey ? 'YES' : 'NO — they are different keys');
console.log('');

function httpGet(host, path) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'GET' }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function testApi(name, path) {
  const res = await httpGet('maps.googleapis.com', path);
  try {
    const json = JSON.parse(res.body);
    const apiStatus = json.status || json.error_message || 'parsed OK';
    const symbol = json.status === 'OK' || json.status === 'ZERO_RESULTS' ? '✓' : '✗';
    const err = json.error_message ? ` — ${json.error_message.slice(0, 80)}` : '';
    console.log(`  ${symbol} ${name.padEnd(25)} ${apiStatus}${err}`);
    return json.status === 'OK' || json.status === 'ZERO_RESULTS';
  } catch {
    console.log(`  ? ${name.padEnd(25)} (unparsable response, HTTP ${res.status})`);
    return false;
  }
}

async function run(label, k) {
  console.log(`--- Testing: ${label} (${k.slice(0, 10)}...${k.slice(-4)}) ---`);
  const query = encodeURIComponent("Nick's Tire & Auto Euclid OH");
  await testApi('Geocoding',      `/maps/api/geocode/json?address=Euclid+OH&key=${k}`);
  await testApi('Places text search', `/maps/api/place/textsearch/json?query=${query}&key=${k}`);
  await testApi('Places findplace',   `/maps/api/place/findplacefromtext/json?input=${query}&inputtype=textquery&fields=place_id&key=${k}`);
  await testApi('Distance Matrix',     `/maps/api/distancematrix/json?origins=Euclid,OH&destinations=Cleveland,OH&key=${k}`);
  console.log('');
}

if (placesKey) await run('GOOGLE_PLACES_API_KEY', placesKey);
if (mapsKey && mapsKey !== placesKey) await run('GOOGLE_MAPS_API_KEY', mapsKey);

console.log('---');
console.log('READING THIS OUTPUT:');
console.log('  ✓ means the API accepted the key and returned results');
console.log('  ✗ means the API rejected the key with an error');
console.log('');
console.log('If ALL lines show ✗ → key is dead or in wrong project');
console.log('If SOME ✓ but Places ✗ → key is alive but Places is blocked (restrictions)');
console.log('If Geocoding ✓ but Places ✗ → you enabled Geocoding, not Places, OR key restrictions still block Places');
