import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "..", "src", "fonts");
const distDir = path.join(__dirname, "..", "dist", "fonts");

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

fs.readdirSync(srcDir).forEach((file) => {
  fs.copyFileSync(path.join(srcDir, file), path.join(distDir, file));
});

console.log("✓ Fonts copied to dist");
