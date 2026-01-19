import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const REPO_ROOT = process.cwd();

const DEFAULT_PLUGINS_DIR = "/home/gernovich/notes/.obsidian/plugins";
const pluginsDir = process.env.OBSIDIAN_PLUGINS_DIR ?? DEFAULT_PLUGINS_DIR;

const manifestPath = path.join(REPO_ROOT, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const pluginId = manifest.id;

if (!pluginId) {
  throw new Error("manifest.json: поле 'id' не задано");
}

const targetDir = path.join(pluginsDir, pluginId);

// 1) build (чтобы main.js был актуальным)
execSync("npm run build", { stdio: "inherit" });

// 2) ensure dir
await fs.mkdir(targetDir, { recursive: true });

// 3) copy files expected by Obsidian
const files = ["manifest.json", "main.js", "styles.css"];
for (const file of files) {
  const src = path.join(REPO_ROOT, file);
  const dest = path.join(targetDir, file);
  await fs.copyFile(src, dest);
}

console.log(`Installed to: ${targetDir}`);
