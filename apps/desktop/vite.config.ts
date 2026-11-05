import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";

/**
 * A test build (VITE_GA_TEST=1) adds src/testHook.ts as a second entry of the page: the regression pass then reaches
 * the app's services inside an installed copy. Any other build leaves the page as it is.
 */
function testHook(): Plugin {
  return {
    name: "gameaccess-test-hook",
    // "pre", so the script is bundled like the main entry instead of being left as a link to the source.
    transformIndexHtml: {
      order: "pre",
      handler: () => process.env.VITE_GA_TEST === "1"
        ? [{ tag: "script", attrs: { type: "module", src: "/src/testHook.ts" }, injectTo: "body" }] : [],
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH || "/",
  plugins: [react(), testHook()],
  define: {
    __BUILD_TIMESTAMP__: JSON.stringify(process.env.VITE_BUILD_TIMESTAMP || new Date().toISOString()),
  },
  // Preserve the raw layout stylesheet in contract tests; Vitest otherwise stubs CSS.
  // NODE_ENV=production in the shell would load the production React build, where act() does not exist.
  test: { env: { NODE_ENV: "test" }, css: { include: [/library-room-layout\.css/] } },
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
    // The small "Connect AI" window (src/aiSteps) is a page of its own, without the rest of the app.
    rollupOptions: { input: { main: "index.html", aiSteps: "ai-steps.html" } },
  },
});
