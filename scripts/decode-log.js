const fs = require('fs');
const path = require('path');

const logPath = 'C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\389886c5-1537-4c0a-b6c3-77a1f8d06374\\.system_generated\\tasks\\task-988.log';
const dest = 'c:\\Users\\nourd\\NOURCITY\\apps\\nickstire\\data\\training\\train.jsonl';

console.log('Reading log file:', logPath);
const logContent = fs.readFileSync(logPath, 'utf8');
const lines = logContent.split(/\r?\n/);

let base64Str = '';
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed) continue;
  if (trimmed.startsWith('Using SSH key')) continue;
  if (trimmed.startsWith('Starting remote')) continue;
  base64Str += trimmed;
}

console.log('Base64 string length:', base64Str.length);
if (base64Str.length === 0) {
  console.error('No base64 data found in log file!');
  process.exit(1);
}

const decoded = Buffer.from(base64Str, 'base64');
console.log('Decoded data size:', decoded.length, 'bytes');

const dir = path.dirname(dest);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.writeFileSync(dest, decoded);
console.log('Successfully wrote decoded file to:', dest);
