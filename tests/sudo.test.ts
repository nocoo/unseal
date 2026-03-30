import { describe, it, expect } from "bun:test";
import { checkSudo } from "../src/sudo.js";
import type { Executor } from "../src/exec.js";

describe("sudo", () => {
  describe("checkSudo", () => {
    it("returns true when passwordless sudo is available", async () => {
      const exec: Executor = async (cmd, args) => {
        if (cmd === "sudo" && args.includes("-n")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      expect(await checkSudo(exec)).toBe(true);
    });

    it("falls back to sudo -v when passwordless sudo fails", async () => {
      const calls: string[][] = [];
      const exec: Executor = async (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === "sudo" && args.includes("-n")) {
          return { stdout: "", stderr: "a password is required", exitCode: 1 };
        }
        if (cmd === "sudo" && args.includes("-v")) {
          return { stdout: "", stderr: "", exitCode: 0 };
        }
        return { stdout: "", stderr: "", exitCode: 1 };
      };

      const result = await checkSudo(exec);

      expect(result).toBe(true);
      expect(calls).toHaveLength(2);
      expect(calls[0]).toEqual(["sudo", "-n", "true"]);
      expect(calls[1]).toEqual(["sudo", "-v"]);
    });

    it("returns false when both sudo -n and sudo -v fail", async () => {
      const exec: Executor = async () => {
        return { stdout: "", stderr: "auth failed", exitCode: 1 };
      };

      expect(await checkSudo(exec)).toBe(false);
    });
  });
});
