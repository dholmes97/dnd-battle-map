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
  },
});
