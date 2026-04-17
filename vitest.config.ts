import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@genergi/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@genergi/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@genergi/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
