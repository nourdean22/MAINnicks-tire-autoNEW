const fs = require('fs');
const path = require('path');
const readline = require('readline');

const rl = readline.createInterface({
  input: fs.createReadStream('C:\\Users\\nourd\\.gemini\\antigravity-ide\\brain\\389886c5-1537-4c0a-b6c3-77a1f8d06374\\.system_generated\\logs\\transcript.jsonl')
});

const userInputs = [];

rl.on('line', (line) => {
  try {
    const obj = JSON.parse(line);
    if (obj.type === 'USER_INPUT') {
      userInputs.push(obj);
    }
  } catch (e) {}
});

rl.on('close', () => {
  // Print the last 5 user inputs
  const last5 = userInputs.slice(-5);
  last5.forEach((msg, i) => {
    console.log(`--- MSG ${i} ---`);
    console.log(msg.content.substring(0, 1000));
  });
});
