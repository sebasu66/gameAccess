import { defineConfig } from "vitest/config";

/** Runs only the *.report.ts files: text reports that are not part of `npm test`. */
export default defineConfig({
  define: { __BUILD_TIMESTAMP__: JSON.stringify("report") },
  test: { include: ["src/**/*.report.ts"], environment: "node" },
});
