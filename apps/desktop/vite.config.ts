import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react()],
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()),
  },
  // Preserve the raw layout stylesheet in contract tests; Vitest otherwise stubs CSS.
  test: { css: { include: [/library-room-layout\.css/] } },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: process.env.TAURI_ENV_DEBUG ? false : "esbuild",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
