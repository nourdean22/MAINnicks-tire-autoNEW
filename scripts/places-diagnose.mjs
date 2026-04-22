// Google Places API diagnostic — tries the exact call gbp-reviews.ts makes
// Run: node scripts/places-diagnose.mjs

import 'dotenv/config';
import https from 'node:https';

const key = process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
if (!key) {
  console.error('No GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY in .env');
  process.exit(1);
}

console.log('=== Google Places API Diagnostic ===');
console.log('Key (masked):', key.slice(0, 10) + '...' + key.slice(-4));
console.log('Key length:  ', key.length);
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

// Same search nickstire cron runs: look up "Nick's Tire & Auto" in Euclid
const query = encodeURIComponent("Nick's Tire & Auto Euclid OH");
const searchPath = `/maps/api/place/textsearch/json?query=${query}&key=${key}`;

console.log('[Step 1] Place textsearch');
const searchRes = await httpGet('maps.googleapis.com', searchPath);
console.log('  HTTP status:', searchRes.status);

try {
  const json = JSON.parse(searchRes.body);
  console.log('  API status: ', json.status);
  if (json.error_message) {
    console.log('  Error msg:  ', json.error_message);
  }

  if (json.status === 'OK') {
    console.log('');
    console.log('*** SUCCESS — Places API is working ***');
    console.log('');
    console.log('Top results:');
    json.results.slice(0, 3).forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name} — ${r.formatted_address}`);
      console.log(`     place_id: ${r.place_id}`);
      console.log(`     rating: ${r.rating || '-'} (${r.user_ratings_total || 0} reviews)`);
    });
    console.log('');
    console.log('The GBP pipeline will succeed on next cron run. No further action needed.');
    process.exit(0);
  } else if (json.status === 'REQUEST_DENIED') {
    console.log('');
    console.log('*** 403 REQUEST_DENIED — same error the production logs show ***');
    console.log('');
    if (json.error_message?.includes('not authorized') || json.error_message?.includes('not been used')) {
      console.log('DIAGNOSIS: Places API is NOT ENABLED in this Google Cloud project.');
      console.log('');
      console.log('FIX:');
      console.log('1. Open: https://console.cloud.google.com/apis/library/places-backend.googleapis.com');
      console.log('   (if prompted, pick your project — likely teezy-491218 since that matches the SA)');
      console.log('2. Click "ENABLE"');
      console.log('3. Wait ~60 seconds for propagation');
      console.log('4. Re-run this script');
    } else if (json.error_message?.includes('API keys with referer')) {
      console.log('DIAGNOSIS: API key is restricted to HTTP referrers, blocking server-side calls.');
      console.log('FIX: In Google Cloud Console → Credentials → edit the Places key');
      console.log('     Change "Application restrictions" to "None" or "IP addresses"');
    } else if (json.error_message?.includes('API key not valid')) {
      console.log('DIAGNOSIS: API key is wrong or disabled.');
      console.log('FIX: Generate a new API key in Google Cloud Console, update Railway.');
    } else {
      console.log('DIAGNOSIS: Unknown REQUEST_DENIED reason. Raw error below:');
      console.log(JSON.stringify(json, null, 2).slice(0, 800));
    }
  } else if (json.status === 'OVER_QUERY_LIMIT') {
    console.log('DIAGNOSIS: Daily quota exceeded or billing not enabled.');
    console.log('FIX: Enable billing on the Google Cloud project.');
  } else if (json.status === 'ZERO_RESULTS') {
    console.log('API responded OK but no results. API is working, just no match.');
  } else {
    console.log('Unexpected status:', json.status);
    console.log(JSON.stringify(json, null, 2).slice(0, 800));
  }
} catch (err) {
  console.log('  Failed to parse JSON response:', err.message);
  console.log('  Raw body:', searchRes.body.slice(0, 800));
}
