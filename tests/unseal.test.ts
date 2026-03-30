import { describe, it, expect } from "bun:test";
import { unsealApps } from "../src/unseal.js";
import type { Executor } from "../src/exec.js";
import type { AppInfo } from "../src/types.js";

function makeApp(name: string): AppInfo {
  return {
    name: `${name}.app`,
    path: `/Applications/${name}.app`,
    status: "quarantined",
  };
}

describe("unseal", () => {
  describe("unsealApps", () => {
    it("returns success for a single app when xattr -rd succeeds", async () => {
      const exec: Executor = async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const results = await unsealApps([makeApp("Good")], exec);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(true);
      expect(results[0].error).toBeUndefined();
    });

    it("returns failure with error for a single app when xattr -rd fails", async () => {
      const exec: Executor = async () => ({
        stdout: "",
        stderr: "Operation not permitted",
        exitCode: 1,
      });

      const results = await unsealApps([makeApp("Bad")], exec);

      expect(results).toHaveLength(1);
      expect(results[0].success).toBe(false);
      expect(results[0].error).toBe("Operation not permitted");
    });

    it("returns all success when multiple apps succeed", async () => {
      const exec: Executor = async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const apps = [makeApp("A"), makeApp("B"), makeApp("C")];
      const results = await unsealApps(apps, exec);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });

    it("handles partial failure without aborting", async () => {
      const exec: Executor = async (_cmd, args) => {
        const path = args[args.length - 1];
        if (path.includes("Fail")) {
          return {
            stdout: "",
            stderr: "Permission denied",
            exitCode: 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const apps = [makeApp("Ok1"), makeApp("Fail"), makeApp("Ok2")];
      const results = await unsealApps(apps, exec);

      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe("Permission denied");
      expect(results[2].success).toBe(true);
    });

    it("returns empty array for empty input", async () => {
      const exec: Executor = async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });

      const results = await unsealApps([], exec);
      expect(results).toEqual([]);
    });
  });
});
