import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function writeNotices(destination) {
  const result = spawnSync("npm", ["ls", "--parseable", "--omit=dev", "--all"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error("Could not inventory runtime dependency licenses.");
  const sections = ["DESK AI FOR WHATSAPP WEB — THIRD-PARTY NOTICES\n\nThe application is MIT licensed. Bundled dependencies and fonts retain their own licenses below. This inventory includes installed runtime dependencies, some of which may be tree-shaken from the build."];
  const seen = new Set();
  for (const path of result.stdout.trim().split("\n").slice(1)) {
    const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
    // PDF.js's optional native Node renderer is not part of browser bundles.
    if (pkg.name.startsWith("@napi-rs/canvas")) continue;
    const id = `${pkg.name}@${pkg.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const files = readdirSync(path).filter((name) => /^(licen[cs]e|notice|ofl)(?:[.-]|$)/i.test(name));
    let text = files.map((name) => `${name}\n${readFileSync(join(path, name), "utf8")}`).join("\n\n");
    if (!text) {
      const readme = readdirSync(path).find((name) => /^readme\.md$/i.test(name));
      text = readme ? readFileSync(join(path, readme), "utf8").match(/## License\s+([\s\S]+)/i)?.[1] : "";
    }
    if (!text) throw new Error(`Missing dependency license text: ${id}`);
    sections.push(`${id}\nLicense: ${pkg.license ?? "See license text"}\n\n${text}`);
  }
  writeFileSync(destination, `${sections.join("\n\n" + "=".repeat(72) + "\n\n")}\n`);
}
