import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@genergi/shared": path.resolve(__dirname, "packages/shared/src/index.ts"),
      "@genergi/config": path.resolve(__dirname, "packages/config/src/index.ts"),
      "@genergi/ui": path.resolve(__dirname, "packages/ui/src/index.ts"),
      "react/jsx-runtime": path.resolve(__dirname, "apps/web/node_modules/react/jsx-runtime.js"),
      "react/jsx-dev-runtime": path.resolve(__dirname, "apps/web/node_modules/react/jsx-dev-runtime.js"),
      react: path.resolve(__dirname, "apps/web/node_modules/react/index.js"),
      "react-dom/client": path.resolve(__dirname, "apps/web/node_modules/react-dom/client.js"),
      "react-dom": path.resolve(__dirname, "apps/web/node_modules/react-dom/index.js"),
      "react-router-dom": path.resolve(__dirname, "apps/web/node_modules/react-router-dom/dist/index.mjs"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
