import { describe, it, expect } from "vitest";
import { createExecutor } from "../src/exec.js";

describe("exec", () => {
  describe("createExecutor (real)", () => {
    it("returns stdout, empty stderr, and exitCode 0 for a successful command", async () => {
      const exec = createExecutor();
      const result = await exec("printf", ["hello"]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe("hello");
      expect(result.stderr).toBe("");
    });

    it("returns stderr and non-zero exit code when the command fails", async () => {
      const exec = createExecutor();
      // `false` always exits 1 with no output on POSIX systems.
      const result = await exec("false", []);

      expect(result.exitCode).toBe(1);
    });

    it("returns non-zero exit code when the binary is missing", async () => {
      const exec = createExecutor();
      const result = await exec("definitely-not-a-real-binary-xyz", []);

      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("createExecutor (mock branch via UNSEAL_MOCK)", () => {
    it("returns the mock executor when UNSEAL_MOCK=1", async () => {
      const original = process.env.UNSEAL_MOCK;
      process.env.UNSEAL_MOCK = "1";
      try {
        const exec = createExecutor();
        const result = await exec("xattr", ["-l", "/Applications/X.app"]);
        expect(result.exitCode).toBe(0);
      } finally {
        if (original === undefined) {
          delete process.env.UNSEAL_MOCK;
        } else {
          process.env.UNSEAL_MOCK = original;
        }
      }
    });
  });
});
