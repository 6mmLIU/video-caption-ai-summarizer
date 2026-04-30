import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(rootDir, "dist");
const manifestPath = join(rootDir, "manifest.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const version = manifest.version;
const packageName = `video-caption-ai-summarizer-${version}`;
const packageDir = join(distDir, packageName);
const zipPath = join(distDir, `${packageName}.zip`);
const copyEntries = [
  "README.md",
  "README.en.md",
  "icons",
  "options",
  "popup",
  "src"
];

delete manifest.key;

await rm(packageDir, { recursive: true, force: true });
await rm(zipPath, { force: true });
await mkdir(packageDir, { recursive: true });

for (const entry of copyEntries) {
  await cp(join(rootDir, entry), join(packageDir, entry), {
    recursive: true,
    force: true,
    filter: (source) => !source.endsWith(".DS_Store")
  });
}

await writeFile(join(packageDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await zipDirectory(distDir, packageName);
console.log(zipPath);

async function zipDirectory(cwd, target) {
  await new Promise((resolveZip, rejectZip) => {
    const zip = spawn("zip", ["-qr", `${target}.zip`, target], { cwd });
    zip.on("error", rejectZip);
    zip.on("close", (code) => {
      if (code === 0) {
        resolveZip();
      } else {
        rejectZip(new Error(`zip exited with code ${code}`));
      }
    });
  });
}
