const { spawn } = require('child_process');
const fs = require('fs');

const dest = 'c:\\Users\\nourd\\NOURCITY\\apps\\nickstire\\data\\training\\train.jsonl';
const chunks = [];

console.log('Starting remote corpus download with memory buffer...');
const child = spawn('railway', ['ssh', '-s', 'MAINnicks-tire-auto', 'cat /tmp/train.jsonl'], {
  shell: true
});

child.stdout.on('data', (chunk) => {
  chunks.push(chunk);
});

child.stderr.on('data', (data) => {
  process.stderr.write(data);
});

child.on('close', (code) => {
  console.log(`\nChild process exited with code ${code}`);
  if (code === 0) {
    const buffer = Buffer.concat(chunks);
    fs.writeFileSync(dest, buffer);
    console.log(`Successfully wrote ${buffer.length} bytes to ${dest}`);
  } else {
    console.error(`Download failed with exit code ${code}`);
  }
});
