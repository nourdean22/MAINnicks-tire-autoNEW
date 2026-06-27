const fs = require('fs');
const readline = require('readline');

const transcriptPath = 'C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\389886c5-1537-4c0a-b6c3-77a1f8d06374\\.system_generated\\logs\\transcript_full.jsonl';
const dest = 'c:\\Users\\nourd\\NOURCITY\\apps\\nickstire\\data\\training\\train.jsonl';

console.log('Reading transcript:', transcriptPath);

const fileStream = fs.createReadStream(transcriptPath);
const rl = readline.createInterface({
  input: fileStream,
  crlfDelay: Infinity
});

let foundBase64 = null;

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const data = JSON.parse(line);
    
    // Check if this step is a PLANNER_RESPONSE or system message containing the command output
    const content = data.content || '';
    if (content.includes('eyJtZXNzYWdlcyI6W3sicm9sZSI6InN5c3RlbSIsImNvbnRlbnQiOiJZb3UgYXJlIE5pY2ss')) {
      // Find the base64 part
      const match = content.match(/eyJtZXNzYWdlcyI6W3sicm9sZSI6InN5c3RlbSIsImNvbnRlbnQiOiJZb3UgYXJlIE5pY2ss[A-Za-z0-9+/=\s]+/);
      if (match) {
        foundBase64 = match[0].replace(/\s/g, '');
      }
    }
  } catch (e) {
    // Ignore JSON parse errors for incomplete lines
  }
});

rl.on('close', () => {
  if (foundBase64) {
    console.log('Found base64 string of length:', foundBase64.length);
    const decoded = Buffer.from(foundBase64, 'base64');
    console.log('Decoded size:', decoded.length, 'bytes');
    fs.writeFileSync(dest, decoded);
    console.log('Successfully wrote decoded corpus to:', dest);
  } else {
    console.error('Could not find base64 corpus in transcript!');
  }
});
