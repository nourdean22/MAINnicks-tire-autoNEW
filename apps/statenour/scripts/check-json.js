const fs = require('fs');
try {
  const raw = fs.readFileSync('package.json', 'utf8');
  JSON.parse(raw);
  console.log('package.json is valid JSON');
  console.log('Length:', raw.length);
} catch(e) {
  console.log('ERROR:', e.message);
  const raw = fs.readFileSync('package.json', 'utf8');
  const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0');
  console.log('Around position', pos, ':', JSON.stringify(raw.substring(Math.max(0,pos-50), pos+50)));
}
