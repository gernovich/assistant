import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";

const REPO_ROOT = process.cwd();

const DEFAULT_PLUGINS_DIR = "/home/gernovich/notes/.obsidian/plugins";
const pluginsDir = process.env.OBSIDIAN_PLUGINS_DIR ?? DEFAULT_PLUGINS_DIR;

const manifestPath = path.join(REPO_ROOT, "resources", "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const pluginId = manifest.id;

if (!pluginId) {
  throw new Error("manifest.json: поле 'id' не задано");
}

const targetDir = path.join(pluginsDir, pluginId);

// 1) build (чтобы dist был актуальным)
execSync("npm run build", { stdio: "inherit" });

// 2) reinstall (копированием dist/)
await fs.rm(targetDir, { recursive: true, force: true });
await fs.mkdir(targetDir, { recursive: true });
await fs.cp(path.join(REPO_ROOT, "dist"), targetDir, { recursive: true });

console.log(`Installed to: ${targetDir}`);
