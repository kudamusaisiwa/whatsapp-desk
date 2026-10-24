import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, readdirSync, lstatSync, copyFileSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { resolve, relative, join } from "node:path";
import { createHash } from "node:crypto";
import { writeNotices } from "./notices.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}). No share ZIP was published.`);
}
const root = resolve("releases/WhatsApp-Desk");
const zip = resolve("releases/WhatsApp-Desk.zip");
const pending = resolve("releases/WhatsApp-Desk.pending.zip");
const audit = resolve("test-results/share-audit");
mkdirSync(audit, { recursive: true });
// Fail before building if the scanner is unavailable. No silent scan bypass.
run("gitleaks", ["version"]);
run(process.execPath, ["scripts/build.mjs", "--share"]);
for (const name of ["START-HERE.html", "START-HERE.txt", "LICENSE"])
  copyFileSync(`sharing/${name}`, join(root, name));
writeNotices(join(root, "THIRD-PARTY-NOTICES.txt"));

const allowed = /^(manifest\.json|panel\.html|background\.js|content\.js|LICENSE|THIRD-PARTY-NOTICES\.txt|START-HERE\.(html|txt)|icons\/(16|48|128)\.png|assets\/[\w.-]+\.(m?js|css|woff2?))$/;
const privateMarkers = /BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/;
const credentials = /(?:sk-(?:proj-|svcacct-|ant-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{35}|gh[pousr]_[A-Za-z0-9]{36,}|(?:AKIA|ASIA)[A-Z0-9]{16}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const inventory = [];
function inspect(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink()) throw new Error("Release contains a symbolic link.");
    if (info.isDirectory()) { inspect(path); continue; }
    const file = relative(root, path).replaceAll("\\", "/");
    if (!allowed.test(file)) throw new Error(`Unexpected release file: ${file}`);
    const bytes = readFileSync(path);
    if (/\.(m?js|json|html|txt|css)$/.test(file)) {
      const text = bytes.toString("utf8");
      if (privateMarkers.test(text)) throw new Error(`Private content remains in ${file}`);
      if (credentials.test(text)) throw new Error(`Possible credential detected in ${file}; inspect locally.`);
    }
    inventory.push({ file, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
}
inspect(root);
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (manifest.name !== "WhatsApp Desk" || manifest.key || manifest.update_url)
  throw new Error("Unexpected shared manifest identity or update configuration.");
run("gitleaks", ["dir", root, "--redact", "--no-banner", "--ignore-gitleaks-allow", "--report-format", "json", "--report-path", join(audit, "release.json")]);
rmSync(pending, { force: true });
try {
  run("zip", ["-q", "-r", pending, "WhatsApp-Desk"], { cwd: resolve("releases") });
  run("unzip", ["-tq", pending]);
  run("gitleaks", ["dir", pending, "--max-archive-depth", "1", "--redact", "--no-banner", "--ignore-gitleaks-allow", "--report-format", "json", "--report-path", join(audit, "archive.json")]);
  renameSync(pending, zip);
} finally {
  rmSync(pending, { force: true });
}
const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha256}  WhatsApp-Desk.zip\n`);
writeFileSync(resolve("releases/WhatsApp-Desk-audit.json"), `${JSON.stringify({
  product: manifest.name,
  version: manifest.version,
  checkedAt: new Date().toISOString(),
  scanner: "Gitleaks; built folder and final ZIP, redacted reports in test-results/share-audit",
  detectedSecrets: 0,
  browserProfileIncluded: false,
  packaging: "Built extension files and installation guides only. No browser profile, source, history, .env, client data or knowledge-base files.",
  limitations: "Automated scanning is not a guarantee against every possible secret. Fresh-install behavior is covered by mocked extension tests; recipient Chrome install still needs to be performed.",
  sha256,
  files: inventory,
}, null, 2)}\n`);
console.log(`Ready to share: ${zip}`);
