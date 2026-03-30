import { describe, it, expect, mock, beforeEach } from "bun:test";
import { listApps } from "../src/scanner.js";
import type { Executor, ExecResult } from "../src/exec.js";
import type { AppInfo } from "../src/types.js";

function makeExec(
  responses: Record<string, ExecResult>
): Executor {
  return async (_cmd, args) => {
    // Key by the last arg (the app path)
    const path = args[args.length - 1];
    return responses[path] ?? { stdout: "", stderr: "", exitCode: 0 };
  };
}

// Mock readdir to control what files are in the directory
const mockReaddir = mock<(dir: string) => Promise<string[]>>();

describe("scanner", () => {
  describe("listApps", () => {
    it("returns all quarantined when all have quarantine attr", async () => {
      const exec = makeExec({
        "/apps/A.app": {
          stdout: "com.apple.quarantine: 0081;abc;Chrome;xyz",
          stderr: "",
          exitCode: 0,
        },
        "/apps/B.app": {
          stdout: "com.apple.quarantine: 0081;def;Firefox;uvw",
          stderr: "",
          exitCode: 0,
        },
        "/apps/C.app": {
          stdout: "com.apple.quarantine: 0081;ghi;Safari;rst",
          stderr: "",
          exitCode: 0,
        },
      });

      const result = await listApps(exec, "/apps", [
        "A.app",
        "B.app",
        "C.app",
      ]);

      expect(result).toHaveLength(3);
      expect(result.every((a) => a.status === "quarantined")).toBe(true);
    });

    it("returns all unsealed when none have quarantine attr", async () => {
      const exec = makeExec({
        "/apps/A.app": { stdout: "", stderr: "", exitCode: 0 },
        "/apps/B.app": {
          stdout: "com.apple.metadata:_kMDItemUserTags",
          stderr: "",
          exitCode: 0,
        },
        "/apps/C.app": { stdout: "", stderr: "", exitCode: 0 },
      });

      const result = await listApps(exec, "/apps", [
        "A.app",
        "B.app",
        "C.app",
      ]);

      expect(result).toHaveLength(3);
      expect(result.every((a) => a.status === "unsealed")).toBe(true);
    });

    it("correctly splits mixed quarantined and unsealed", async () => {
      const exec = makeExec({
        "/apps/A.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "/apps/B.app": { stdout: "", stderr: "", exitCode: 0 },
        "/apps/C.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
      });

      const result = await listApps(exec, "/apps", [
        "A.app",
        "B.app",
        "C.app",
      ]);

      const quarantined = result.filter((a) => a.status === "quarantined");
      const unsealed = result.filter((a) => a.status === "unsealed");
      expect(quarantined).toHaveLength(2);
      expect(unsealed).toHaveLength(1);
    });

    it("returns empty array for empty directory", async () => {
      const exec = makeExec({});
      const result = await listApps(exec, "/apps", []);
      expect(result).toEqual([]);
    });

    it("filters to only .app entries", async () => {
      const exec = makeExec({
        "/apps/Real.app": { stdout: "", stderr: "", exitCode: 0 },
      });

      const result = await listApps(exec, "/apps", [
        "Real.app",
        "notanapp.txt",
        "folder",
        "another.pkg",
      ]);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Real.app");
    });

    it("returns results sorted alphabetically by name", async () => {
      const exec = makeExec({
        "/apps/Zebra.app": { stdout: "", stderr: "", exitCode: 0 },
        "/apps/Alpha.app": { stdout: "", stderr: "", exitCode: 0 },
        "/apps/Middle.app": { stdout: "", stderr: "", exitCode: 0 },
      });

      const result = await listApps(exec, "/apps", [
        "Zebra.app",
        "Alpha.app",
        "Middle.app",
      ]);

      expect(result.map((a) => a.name)).toEqual([
        "Alpha.app",
        "Middle.app",
        "Zebra.app",
      ]);
    });

    it("marks xattr command failure as unknown with error message", async () => {
      const exec: Executor = async (_cmd, args) => {
        const path = args[args.length - 1];
        if (path === "/apps/Broken.app") {
          return {
            stdout: "",
            stderr: "permission denied",
            exitCode: 1,
          };
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const result = await listApps(exec, "/apps", [
        "Good.app",
        "Broken.app",
      ]);

      const good = result.find((a) => a.name === "Good.app")!;
      const broken = result.find((a) => a.name === "Broken.app")!;

      expect(good.status).toBe("unsealed");
      expect(broken.status).toBe("unknown");
      expect(broken.error).toBe("permission denied");
    });

    it("scans custom directory path", async () => {
      const exec = makeExec({
        "/custom/path/App.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
      });

      const result = await listApps(exec, "/custom/path", ["App.app"]);

      expect(result).toHaveLength(1);
      expect(result[0].path).toBe("/custom/path/App.app");
      expect(result[0].status).toBe("quarantined");
    });

    it("handles executor throwing an exception as unknown", async () => {
      const exec: Executor = async () => {
        throw new Error("spawn failed");
      };

      const result = await listApps(exec, "/apps", ["Crash.app"]);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("unknown");
      expect(result[0].error).toBe("spawn failed");
    });

    it("handles non-Error thrown values", async () => {
      const exec: Executor = async () => {
        throw "string error";
      };

      const result = await listApps(exec, "/apps", ["Crash.app"]);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("unknown");
      expect(result[0].error).toBe("string error");
    });
  });
});
