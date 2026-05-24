/**
 * Build pilpod-companion.zip for sideloading (excludes node_modules, tests, dev files).
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const zipPath = join(root, "pilpod-companion.zip");

if (!existsSync(join(root, "dist", "content.js"))) {
  throw new Error("dist/content.js missing — run npm run build first");
}

const items = [
  "manifest.json",
  "dist",
  "src/background.js",
  "src/background",
  "src/shared",
];

if (existsSync(zipPath)) {
  execSync(`Remove-Item -LiteralPath '${zipPath.replace(/'/g, "''")}' -Force`, {
    cwd: root,
    shell: "powershell.exe",
    stdio: "inherit",
  });
}

const pathsArg = items.map((item) => `'${item.replace(/'/g, "''")}'`).join(",");
execSync(
  `Compress-Archive -Path ${pathsArg} -DestinationPath 'pilpod-companion.zip' -Force`,
  { cwd: root, shell: "powershell.exe", stdio: "inherit" },
);

console.log(`Created ${zipPath}`);
