// Mock server-only before any other imports
const Module = require('module');
Module._cache['server-only'] = {
  id: 'server-only',
  exports: {},
  loaded: true,
  path: '',
  paths: [],
};

import { computeCharacterSheet } from "../lib/mastery/character-sheet";

async function main() {
  console.log("Calling computeCharacterSheet...");
  try {
    const sheet = await computeCharacterSheet();
    console.log("SUCCESS! Result length:", sheet.length);
    console.log("First few items:", JSON.stringify(sheet.slice(0, 3), null, 2));
  } catch (err) {
    console.error("ERROR running computeCharacterSheet:", err);
  }
}

main();
