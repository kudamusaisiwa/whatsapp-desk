import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { writeNotices } from "./notices.mjs";

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}).`);
}

const licenseApi = process.env.WHATSAPP_DESK_LICENSE_API_URL ?? "";
if (!licenseApi)
  throw new Error(
    "Set WHATSAPP_DESK_LICENSE_API_URL to the HTTPS license service before packaging the Web Store build.",
  );
const parsed = new URL(licenseApi);
if (parsed.protocol !== "https:")
  throw new Error("WHATSAPP_DESK_LICENSE_API_URL must use HTTPS.");

const root = resolve("releases/WhatsApp-Desk-WebStore");
const zip = resolve("releases/WhatsApp-Desk-WebStore.zip");
const pending = resolve("releases/WhatsApp-Desk-WebStore.pending.zip");
const reportDir = resolve("test-results");
const staging = resolve("test-results/webstore-staging");
mkdirSync(reportDir, { recursive: true });
rmSync(root, { recursive: true, force: true });
rmSync(pending, { force: true });
rmSync(staging, { recursive: true, force: true });

run(process.execPath, ["scripts/build.mjs", "--webstore"]);
copyFileSync("sharing/LICENSE", join(root, "LICENSE"));
writeNotices(join(root, "THIRD-PARTY-NOTICES.txt"));

const allowed =
  /^(manifest\.json|panel\.html|background\.js|content\.js|LICENSE|THIRD-PARTY-NOTICES\.txt|icons\/(16|48|128)\.png|assets\/[\w.-]+\.(m?js|css|woff2?))$/;
const files = [];
function inspect(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const info = lstatSync(path);
    if (info.isSymbolicLink())
      throw new Error("Web Store package contains a symbolic link.");
    if (info.isDirectory()) {
      inspect(path);
      continue;
    }
    const file = relative(root, path).replaceAll("\\", "/");
    if (!allowed.test(file)) throw new Error(`Unexpected Web Store file: ${file}`);
    const bytes = readFileSync(path);
    files.push({
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
}
inspect(root);

const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
if (manifest.name !== "Desk AI for WhatsApp Web" || manifest.key || manifest.update_url)
  throw new Error("Unexpected Web Store manifest identity or update configuration.");
if (!manifest.host_permissions?.some((value) => String(value).startsWith(parsed.origin)))
  throw new Error("The Web Store manifest is missing the configured license API host.");

run("gitleaks", [
  "dir",
  root,
  "--redact",
  "--no-banner",
  "--ignore-gitleaks-allow",
  "--report-format",
  "json",
  "--report-path",
  join(reportDir, "webstore-release.json"),
]);

mkdirSync(staging, { recursive: true });
for (const file of files) {
  const source = join(root, file.file);
  const target = join(staging, file.file);
  mkdirSync(resolve(target, ".."), { recursive: true });
  copyFileSync(source, target);
}
run("zip", ["-q", "-r", pending, "."], { cwd: staging });
run("unzip", ["-tq", pending]);
run("gitleaks", [
  "dir",
  pending,
  "--max-archive-depth",
  "1",
  "--redact",
  "--no-banner",
  "--ignore-gitleaks-allow",
  "--report-format",
  "json",
  "--report-path",
  join(reportDir, "webstore-archive.json"),
]);
renameSync(pending, zip);
rmSync(staging, { recursive: true, force: true });

const sha256 = createHash("sha256").update(readFileSync(zip)).digest("hex");
writeFileSync(`${zip}.sha256`, `${sha256}  WhatsApp-Desk-WebStore.zip\n`);
writeFileSync(
  "releases/WhatsApp-Desk-WebStore-audit.json",
  `${JSON.stringify(
    {
      product: manifest.name,
      version: manifest.version,
      licenseApiOrigin: parsed.origin,
      sha256,
      files,
      secretScan: "gitleaks over the built folder and final ZIP",
    },
    null,
    2,
  )}\n`,
);
console.log(`Ready for Chrome Web Store upload: ${zip}`);
