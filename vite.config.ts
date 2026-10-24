import { defineConfig } from "vite";
import { resolve } from "node:path";

const storeRelease = process.env.WHATSAPP_DESK_STORE === "true";
const licenseApi = process.env.WHATSAPP_DESK_LICENSE_API_URL ?? "";

export default defineConfig({
  base: "./",
  define: {
    __WHATSAPP_DESK_STORE__: JSON.stringify(storeRelease),
    __WHATSAPP_DESK_LICENSE_API__: JSON.stringify(licenseApi),
  },
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
