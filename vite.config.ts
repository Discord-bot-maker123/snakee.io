import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: resolve(__dirname, "client"),
  publicDir: resolve(__dirname, "client", "public"),
  build: {
    outDir: resolve(__dirname, "dist", "client"),
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});
