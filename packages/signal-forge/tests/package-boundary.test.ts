import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAllFiles(dirPath: string, arrayOfFiles: string[] = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach(function(file) {
    if (fs.statSync(dirPath + "/" + file).isDirectory()) {
      arrayOfFiles = getAllFiles(dirPath + "/" + file, arrayOfFiles);
    } else if (file.endsWith('.ts')) {
      arrayOfFiles.push(path.join(dirPath, "/", file));
    }
  });

  return arrayOfFiles;
}

describe("Package Boundary", () => {
  it("does not import from forbidden app boundaries", () => {
    const srcDir = path.join(__dirname, "../src");
    const files = getAllFiles(srcDir);
    
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      
      // Should not import from apps
      expect(content).not.toMatch(/from ['"](\.\.\/)*apps\/nickstire/);
      expect(content).not.toMatch(/from ['"](\.\.\/)*apps\/statenour/);
      
      // Should not import from other unrelated packages directly (unless registered in package.json, but here we enforce purity)
      expect(content).not.toMatch(/from ['"]@nour\/(?!signal-forge)/);
    }
  });
});
