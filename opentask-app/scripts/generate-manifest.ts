import fs from "node:fs";
import path from "node:path";

const rootDir = path.resolve(import.meta.dir, "..");
const tauriConfPath = path.join(rootDir, "src-tauri", "tauri.conf.json");
const bundleDir = path.join(rootDir, "src-tauri", "target", "release", "bundle", "nsis");

if (!fs.existsSync(bundleDir)) {
  console.error("Error: Bundle directory not found. Please run `bun run tauri:build:signed` first.");
  process.exit(1);
}

const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, "utf-8"));
const version = tauriConf.version || "0.1.0";

// Find .exe and .sig matching the version from tauri.conf.json
const files = fs.readdirSync(bundleDir);
const exeFile =
  files.find((f) => f.includes(`_${version}_`) && f.endsWith("-setup.exe") && !f.startsWith(".")) ||
  files.find((f) => f.endsWith("-setup.exe"));

const sigFile =
  files.find((f) => f.includes(`_${version}_`) && f.endsWith("-setup.exe.sig") && !f.startsWith(".")) ||
  files.find((f) => f.endsWith("-setup.exe.sig"));

if (!exeFile || !sigFile) {
  console.error("Error: Could not find setup .exe or .sig file for version", version, "in", bundleDir);
  process.exit(1);
}

// Ensure spaces are replaced with dots for GitHub Release asset compatibility
const sanitizedExe = exeFile.replace(/\s+/g, ".");
const sanitizedSig = sigFile.replace(/\s+/g, ".");

if (sanitizedExe !== exeFile) {
  fs.copyFileSync(path.join(bundleDir, exeFile), path.join(bundleDir, sanitizedExe));
}
if (sanitizedSig !== sigFile) {
  fs.copyFileSync(path.join(bundleDir, sigFile), path.join(bundleDir, sanitizedSig));
}

const signature = fs.readFileSync(path.join(bundleDir, sigFile), "utf-8").trim();

const manifest = {
  version,
  notes: `OpenTask Desktop Release v${version}`,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url: `https://github.com/Offside-Software/OpenTask/releases/download/v${version}/${sanitizedExe}`,
    },
  },
};

const outputPath = path.join(bundleDir, "latest.json");
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2), "utf-8");

console.log("\n=======================================================");
console.log("  Update Manifest (latest.json) Generated Successfully ");
console.log("=======================================================\n");
console.log("Path:", outputPath);
console.log("Version:", version);
console.log("Target Binary URL:", manifest.platforms["windows-x86_64"].url);
console.log("\nAssets to publish to GitHub Release (tag: v" + version + "):");
console.log("  1. " + sanitizedExe);
console.log("  2. " + sanitizedSig);
console.log("  3. latest.json\n");
