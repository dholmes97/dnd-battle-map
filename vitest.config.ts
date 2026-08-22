import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": projectRoot } },
  test: {
    environment: "jsdom",
    include: ["tests/components/**/*.test.tsx"],
    clearMocks: true,
    setupFiles: ["tests/components/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage/components",
      include: ["app/**/*.{ts,tsx}", "shared/**/*.ts"],
      exclude: [
        "app/layout.tsx",
        "app/page.tsx",
        "**/*.d.ts",
      ],
      thresholds: {
        statements: 18,
        branches: 17,
        functions: 20,
        lines: 22,
        "app/use-encounter-sync.ts": {
          statements: 78,
          branches: 62,
          functions: 84,
          lines: 87,
        },
      },
    },
  },
});
