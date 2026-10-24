import { defineConfig } from "vite";
import { resolve } from "node:path";
export default defineConfig({
  base: "./",
  server: { host: "127.0.0.1", port: 4173, strictPort: true },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        preview: resolve(import.meta.dirname, "index.html"),
        panel: resolve(import.meta.dirname, "panel.html"),
      },
    },
  },
});
