import { build } from "esbuild";
import { build as viteBuild, loadConfigFromFile } from "vite";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const share = process.argv.includes("--share");
const outdir = share ? "releases/WhatsApp-Desk" : "dist";
await import("./icons.mjs");
const { config } = await loadConfigFromFile({ command: "build", mode: "production" });
await viteBuild({
  ...config,
  configFile: false,
  build: {
    ...config.build,
    outDir: outdir,
    ...(share ? { rollupOptions: { ...config.build?.rollupOptions, input: { panel: resolve("panel.html") } } } : {}),
  },
});
await build({
  entryPoints: ["src/background.ts"],
  loader: { ".txt": "text" },
  bundle: true,
  outdir,
  format: "esm",
  target: "chrome120",
  minify: true,
});
await build({
  entryPoints: ["src/content.ts"],
  bundle: true,
  outdir,
  format: "iife",
  target: "chrome120",
  minify: true,
});
if (share) {
  const path = `${outdir}/manifest.json`;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.name = "WhatsApp Desk";
  manifest.action.default_title = "Open WhatsApp Desk";
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  // Design preview is unnecessary in an installable release.
  rmSync(`${outdir}/index.html`, { force: true });
}
console.log(`Extension ready: load ${outdir} in Chrome.`);
