const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\389886c5-1537-4c0a-b6c3-77a1f8d06374\\.system_generated\\logs\\transcript_full.jsonl')
});

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'USER_INPUT' && obj.content && obj.content.includes('best specimiments')) {
      // Dump the content to a file so we can view it
      fs.writeFileSync('C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\389886c5-1537-4c0a-b6c3-77a1f8d06374\\scratch\\user-report.md', obj.content);
      console.log('Successfully wrote user-report.md');
      process.exit(0);
    }
  } catch (e) {}
});

rl.on('close', () => {
  console.log('Finished reading transcript, no match found.');
});
