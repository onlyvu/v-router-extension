import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules/**", "dist/**"],
    restoreMocks: true,
    coverage: {
      reporter: ["text", "lcov"]
    }
  }
});
