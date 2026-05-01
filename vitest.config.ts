import { defineConfig } from "vitest/config";

export default defineConfig({
  cacheDir: "node_modules/.cache/vitest",
  test: {
    globals: false,
    include: ["tests/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
    ],
    coverage: {
      provider: "v8",
      // Vitest v4 has AST-aware remapping enabled by default; the
      // experimentalAstAwareRemapping flag from v3 is no longer needed.
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        // Type definitions only — no runtime code.
        "**/types.ts",
        // Mock executor only runs when UNSEAL_MOCK=1, used for manual smoke
        // testing the CLI against fake xattr/spctl output. The production
        // path uses the real executor; coverage of the mock branch would
        // require running the CLI with the env var set.
        "**/mock-executor.ts",
      ],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
