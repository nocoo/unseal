import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.cache/vitest",
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    coverage: {
      provider: "v8",
      // Vitest v4 has AST-aware remapping enabled by default; the
      // experimentalAstAwareRemapping flag from v3 is no longer needed.
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Type definitions only — no runtime code.
        "**/types.ts",
        // Dev-only entry: exercised manually via `bun run debug`, never
        // shipped (tree-shaken from dist/ because src/index.ts doesn't
        // import it). Not worth unit-testing the scenario harness itself.
        "**/debug.ts",
      ],
      thresholds: {
        statements: 98,
        branches: 98,
        functions: 98,
        lines: 98,
      },
    },
  },
});
