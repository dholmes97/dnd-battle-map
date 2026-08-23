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
        "app/battle-map-renderer.ts": {
          statements: 32,
          branches: 25,
          functions: 48,
          lines: 32,
        },
        "app/map-scene-renderer.ts": {
          statements: 47,
          branches: 36,
          functions: 66,
          lines: 52,
        },
        "app/use-map-assets.ts": {
          statements: 84,
          branches: 71,
          functions: 86,
          lines: 95,
        },
        "shared/battle-map-animation.ts": {
          statements: 94,
          branches: 72,
          functions: 100,
          lines: 93,
        },
        "shared/token-label-layout.ts": {
          statements: 92,
          branches: 83,
          functions: 81,
          lines: 94,
        },
      },
    },
  },
});
