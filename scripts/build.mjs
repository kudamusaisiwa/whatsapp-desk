import { build } from "esbuild";
import { build as viteBuild, loadConfigFromFile } from "vite";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
const share = process.argv.includes("--share");
const webstore = process.argv.includes("--webstore");
if (share && webstore) throw new Error("Choose either --share or --webstore.");
const outdir = webstore
  ? "releases/WhatsApp-Desk-WebStore"
  : share
    ? "releases/WhatsApp-Desk"
    : "dist";
const licenseApi = process.env.WHATSAPP_DESK_LICENSE_API_URL ?? "";
if (webstore) {
  let parsed;
  try {
    parsed = new URL(licenseApi);
  } catch {
    throw new Error(
      "Web Store builds require WHATSAPP_DESK_LICENSE_API_URL to be an HTTPS URL.",
    );
  }
  if (parsed.protocol !== "https:")
    throw new Error(
      "Web Store builds require WHATSAPP_DESK_LICENSE_API_URL to use HTTPS.",
    );
}
process.env.WHATSAPP_DESK_STORE = webstore ? "true" : "false";
await import("./icons.mjs");
const { config } = await loadConfigFromFile({ command: "build", mode: "production" });
await viteBuild({
  ...config,
  configFile: false,
  build: {
    ...config.build,
    outDir: outdir,
    ...(share || webstore
      ? {
          rollupOptions: {
            ...config.build?.rollupOptions,
            input: { panel: resolve("panel.html") },
          },
        }
      : {}),
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
  define: {
    __WHATSAPP_DESK_STORE__: JSON.stringify(webstore),
    __WHATSAPP_DESK_LICENSE_API__: JSON.stringify(licenseApi),
  },
});
await build({
  entryPoints: ["src/content.ts"],
  bundle: true,
  outdir,
  format: "iife",
  target: "chrome120",
  minify: true,
  define: {
    __WHATSAPP_DESK_STORE__: JSON.stringify(webstore),
    __WHATSAPP_DESK_LICENSE_API__: JSON.stringify(licenseApi),
  },
});
if (share || webstore) {
  const path = `${outdir}/manifest.json`;
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.name = "Desk AI for WhatsApp Web";
  manifest.action.default_title = "Open Desk AI for WhatsApp Web";
  if (webstore) {
    const origin = new URL(licenseApi).origin;
    manifest.host_permissions = [
      ...new Set([...(manifest.host_permissions ?? []), `${origin}/*`]),
    ];
    const csp = manifest.content_security_policy?.extension_pages;
    if (typeof csp === "string" && !csp.includes(origin)) {
      const directives = csp
        .split(";")
        .map((directive) => directive.trim())
        .filter(Boolean);
      const connectIndex = directives.findIndex((directive) =>
        directive.startsWith("connect-src "),
      );
      if (connectIndex >= 0) directives[connectIndex] += ` ${origin}`;
      else directives.push(`connect-src 'self' ${origin}`);
      manifest.content_security_policy.extension_pages = directives.join("; ");
    }
  }
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
  // Design preview is unnecessary in an installable release.
  rmSync(`${outdir}/index.html`, { force: true });
}
console.log(`Extension ready: load ${outdir} in Chrome.`);
