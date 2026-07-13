import { describe, expect, it } from "vitest";
import { createExecutor } from "../src/exec.js";

describe("exec", () => {
  describe("createExecutor", () => {
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
      // ENOENT arrives on error.code as a string; earlier code called
      // Number("ENOENT") and produced NaN, which failed every downstream
      // `exitCode !== 0` branch. Assert we now normalise to a valid integer.
      expect(Number.isFinite(result.exitCode)).toBe(true);
      // Node's stderr is empty on spawn failure; the message must surface.
      expect(result.stderr.length).toBeGreaterThan(0);
    });
  });
});
