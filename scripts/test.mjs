import { build } from "esbuild";
import { readdirSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
mkdirSync("test-results", { recursive: true });
const files = readdirSync("tests").filter((f) => f.endsWith(".test.ts"));
await build({
  entryPoints: files.map((f) => `tests/${f}`),
  loader: { ".txt": "text" },
  outdir: "test-results",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
});
const result = spawnSync(
  process.execPath,
  ["--test", ...files.map((f) => `test-results/${f.replace(".ts", ".mjs")}`)],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
