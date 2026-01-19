import fs from "fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

function writeJson(path, obj) {
  fs.writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

const manifestPath = "manifest.json";
const versionsPath = "versions.json";

const manifest = readJson(manifestPath);
const versions = readJson(versionsPath);

const version = process.env.npm_package_version ?? manifest.version;
manifest.version = version;
versions[version] = manifest.minAppVersion;

writeJson(manifestPath, manifest);
writeJson(versionsPath, versions);
