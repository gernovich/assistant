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

// 3) native deps (gst-kit) — Obsidian plugin folder не содержит node_modules, поэтому копируем явно.
// Важно: gst-kit грузит native addon из build/Release/gst_kit.node относительно своего package root.
try {
  const gstKitSrc = path.join(REPO_ROOT, "node_modules", "gst-kit");
  const gstKitDst = path.join(targetDir, "node_modules", "gst-kit");
  await fs.mkdir(path.dirname(gstKitDst), { recursive: true });
  await fs.cp(gstKitSrc, gstKitDst, { recursive: true });
  console.log(`Copied native dependency: gst-kit -> ${gstKitDst}`);
} catch (e) {
  console.warn("WARN: failed to copy gst-kit into Obsidian plugin folder. GStreamer features may not work.");
  console.warn(String(e ?? ""));
}

console.log(`Installed to: ${targetDir}`);
