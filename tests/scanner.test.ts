import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ExecResult, Executor } from "../src/exec.js";
import { listApps } from "../src/scanner.js";

/**
 * Build a mock executor that dispatches on `cmd:path` composite key first,
 * then falls back to path-only key for backwards compatibility.
 * Example keys: "xattr:/apps/A.app", "spctl:/apps/A.app", or just "/apps/A.app".
 */
function makeExec(responses: Record<string, ExecResult>): Executor {
  return async (cmd, args) => {
    const path = args[args.length - 1];
    const compositeKey = `${cmd}:${path}`;
    return responses[compositeKey] ?? responses[path] ?? { stdout: "", stderr: "", exitCode: 0 };
  };
}

describe("scanner", () => {
  describe("listApps", () => {
    it("returns all quarantined when all have quarantine attr and spctl rejects", async () => {
      const exec = makeExec({
        "xattr:/apps/A.app": {
          stdout: "com.apple.quarantine: 0081;abc;Chrome;xyz",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/A.app": { stdout: "", stderr: "rejected", exitCode: 3 },
        "xattr:/apps/B.app": {
          stdout: "com.apple.quarantine: 0081;def;Firefox;uvw",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/B.app": { stdout: "", stderr: "rejected", exitCode: 3 },
        "xattr:/apps/C.app": {
          stdout: "com.apple.quarantine: 0081;ghi;Safari;rst",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/C.app": { stdout: "", stderr: "rejected", exitCode: 3 },
      });

      const result = await listApps(exec, "/apps", ["A.app", "B.app", "C.app"]);

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

      const result = await listApps(exec, "/apps", ["A.app", "B.app", "C.app"]);

      expect(result).toHaveLength(3);
      expect(result.every((a) => a.status === "unsealed")).toBe(true);
    });

    it("correctly splits mixed quarantined and unsealed", async () => {
      const exec = makeExec({
        "xattr:/apps/A.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/A.app": { stdout: "", stderr: "rejected", exitCode: 3 },
        "xattr:/apps/B.app": { stdout: "", stderr: "", exitCode: 0 },
        "xattr:/apps/C.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/C.app": { stdout: "", stderr: "rejected", exitCode: 3 },
      });

      const result = await listApps(exec, "/apps", ["A.app", "B.app", "C.app"]);

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

      const result = await listApps(exec, "/apps", ["Zebra.app", "Alpha.app", "Middle.app"]);

      expect(result.map((a) => a.name)).toEqual(["Alpha.app", "Middle.app", "Zebra.app"]);
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

      const result = await listApps(exec, "/apps", ["Good.app", "Broken.app"]);

      const good = result.find((a) => a.name === "Good.app")!;
      const broken = result.find((a) => a.name === "Broken.app")!;

      expect(good.status).toBe("unsealed");
      expect(broken.status).toBe("unknown");
      expect(broken.error).toBe("permission denied");
    });

    it("falls back to 'xattr exited with code N' when xattr fails with empty stderr", async () => {
      const exec: Executor = async () => ({
        stdout: "",
        stderr: "",
        exitCode: 5,
      });

      const result = await listApps(exec, "/apps", ["Quiet.app"]);

      expect(result[0].status).toBe("unknown");
      expect(result[0].error).toBe("xattr exited with code 5");
    });

    it("scans custom directory path", async () => {
      const exec = makeExec({
        "xattr:/custom/path/App.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/custom/path/App.app": {
          stdout: "",
          stderr: "rejected",
          exitCode: 3,
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

    it("treats quarantined app as unsealed when spctl passes (signed app)", async () => {
      const exec = makeExec({
        "xattr:/apps/Signed.app": {
          stdout: "com.apple.quarantine: 0081;abc;Safari;xyz",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/Signed.app": {
          stdout: "/apps/Signed.app: accepted",
          stderr: "",
          exitCode: 0,
        },
      });

      const result = await listApps(exec, "/apps", ["Signed.app"]);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("unsealed");
    });

    it("handles mixed spctl results within same batch", async () => {
      const exec = makeExec({
        // Signed & quarantined → spctl passes → unsealed
        "xattr:/apps/SignedApp.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/SignedApp.app": {
          stdout: "accepted",
          stderr: "",
          exitCode: 0,
        },
        // Unsigned & quarantined → spctl rejects → quarantined
        "xattr:/apps/UnsignedApp.app": {
          stdout: "com.apple.quarantine: 0081",
          stderr: "",
          exitCode: 0,
        },
        "spctl:/apps/UnsignedApp.app": {
          stdout: "",
          stderr: "rejected",
          exitCode: 3,
        },
        // No quarantine xattr → unsealed (spctl never called)
        "xattr:/apps/Clean.app": {
          stdout: "",
          stderr: "",
          exitCode: 0,
        },
      });

      const result = await listApps(exec, "/apps", [
        "SignedApp.app",
        "UnsignedApp.app",
        "Clean.app",
      ]);

      const statuses = Object.fromEntries(result.map((a) => [a.name, a.status]));
      expect(statuses["SignedApp.app"]).toBe("unsealed");
      expect(statuses["UnsignedApp.app"]).toBe("quarantined");
      expect(statuses["Clean.app"]).toBe("unsealed");
    });

    it("calls onProgress in entry order with app names", async () => {
      const exec = makeExec({
        "/apps/B.app": { stdout: "", stderr: "", exitCode: 0 },
        "/apps/A.app": { stdout: "", stderr: "", exitCode: 0 },
      });

      const progressCalls: string[] = [];
      await listApps(exec, "/apps", ["B.app", "A.app"], (name) => {
        progressCalls.push(name);
      });

      // onProgress called in entry order (before sorting)
      expect(progressCalls).toEqual(["B.app", "A.app"]);
    });

    it("works without onProgress callback", async () => {
      const exec = makeExec({
        "/apps/X.app": { stdout: "", stderr: "", exitCode: 0 },
      });

      // Should not throw when onProgress is omitted
      const result = await listApps(exec, "/apps", ["X.app"]);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe("unsealed");
    });

    it("reads directory entries from disk when entries arg is omitted", async () => {
      const dir = await mkdtemp(join(tmpdir(), "unseal-scanner-"));
      try {
        await mkdir(join(dir, "Foo.app"));
        await mkdir(join(dir, "Bar.app"));
        await writeFile(join(dir, "ignored.txt"), "");

        const exec: Executor = async () => ({
          stdout: "",
          stderr: "",
          exitCode: 0,
        });

        const result = await listApps(exec, dir);

        expect(result.map((a) => a.name)).toEqual(["Bar.app", "Foo.app"]);
        expect(result.every((a) => a.status === "unsealed")).toBe(true);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });

  describe("listApps concurrency", () => {
    /**
     * Instrumented executor: for every call, increments an in-flight
     * counter, waits until the test releases it, then decrements. Lets
     * the test observe the peak concurrency actually reached.
     */
    function makeInstrumentedExec(
      opts: {
        stdoutFor?: (cmd: string, path: string) => string;
        exitCodeFor?: (cmd: string, path: string) => number;
      } = {},
    ): {
      exec: Executor;
      state: {
        inFlight: number;
        peakInFlight: number;
        totalCalls: number;
        completedCalls: number;
        outstanding: (() => void)[];
        callLog: string[];
      };
      releaseAll: () => void;
      releaseOne: () => void;
    } {
      const state = {
        inFlight: 0,
        peakInFlight: 0,
        totalCalls: 0,
        completedCalls: 0,
        outstanding: [] as (() => void)[],
        callLog: [] as string[],
      };

      const exec: Executor = (cmd, args) => {
        const path = args[args.length - 1] ?? "";
        state.totalCalls += 1;
        state.inFlight += 1;
        state.peakInFlight = Math.max(state.peakInFlight, state.inFlight);
        state.callLog.push(`${cmd}:${path}`);

        return new Promise((resolve) => {
          const finish = (): void => {
            state.inFlight -= 1;
            state.completedCalls += 1;
            resolve({
              stdout: opts.stdoutFor?.(cmd, path) ?? "",
              stderr: "",
              exitCode: opts.exitCodeFor?.(cmd, path) ?? 0,
            });
          };
          state.outstanding.push(finish);
        });
      };

      return {
        exec,
        state,
        releaseAll: () => {
          while (state.outstanding.length > 0) {
            const f = state.outstanding.shift();
            f?.();
          }
        },
        releaseOne: () => {
          const f = state.outstanding.shift();
          f?.();
        },
      };
    }

    /**
     * Spin the event loop N times so pending promise microtasks can be
     * observed. Each `await Promise.resolve()` flushes one microtask
     * turn — 20 turns is plenty for the pool to dispatch all workers.
     */
    async function flushMicrotasks(turns = 20): Promise<void> {
      for (let i = 0; i < turns; i += 1) {
        await Promise.resolve();
      }
    }

    it("never has more than `concurrency` xattr calls in flight (default 3)", async () => {
      const { exec, state, releaseAll } = makeInstrumentedExec();
      const apps = Array.from({ length: 20 }, (_, i) => `App${i}.app`);

      const scanPromise = listApps(exec, "/apps", apps);

      // Let the pool spin up all workers.
      await flushMicrotasks();

      expect(state.inFlight).toBe(3);
      expect(state.totalCalls).toBe(3);

      // Drain the queue, checking cap holds after each release.
      while (state.completedCalls < apps.length) {
        releaseAll();
        await flushMicrotasks();
        expect(state.inFlight).toBeLessThanOrEqual(3);
        expect(state.peakInFlight).toBeLessThanOrEqual(3);
      }

      const result = await scanPromise;
      expect(result).toHaveLength(apps.length);
      expect(state.peakInFlight).toBe(3);
    });

    it("respects a custom `concurrency` option", async () => {
      const { exec, state, releaseAll } = makeInstrumentedExec();
      const apps = Array.from({ length: 10 }, (_, i) => `App${i}.app`);

      const scanPromise = listApps(exec, "/apps", apps, undefined, {
        concurrency: 5,
      });

      await flushMicrotasks();
      expect(state.inFlight).toBe(5);

      while (state.completedCalls < apps.length) {
        releaseAll();
        await flushMicrotasks();
        expect(state.inFlight).toBeLessThanOrEqual(5);
      }
      await scanPromise;
      expect(state.peakInFlight).toBe(5);

      // Only xattr calls happened (no quarantine attr → no spctl).
      expect(state.totalCalls).toBe(apps.length);
    });

    it("caps peak concurrency including spctl calls (quarantined apps trigger a 2nd exec)", async () => {
      // Every app has quarantine attr → each app costs 2 execs (xattr + spctl).
      // Peak concurrency of the POOL (per-app chains) must stay ≤ 3,
      // NOT peak concurrency of raw exec calls (a spctl is issued
      // strictly after its xattr resolves in the same chain).
      const { exec, state, releaseAll } = makeInstrumentedExec({
        stdoutFor: (cmd) => (cmd === "xattr" ? "com.apple.quarantine: 0081" : ""),
        exitCodeFor: (cmd) => (cmd === "spctl" ? 3 : 0),
      });
      const apps = Array.from({ length: 6 }, (_, i) => `App${i}.app`);

      const scanPromise = listApps(exec, "/apps", apps);

      // Round 1: 3 xattrs in flight.
      await flushMicrotasks();
      expect(state.inFlight).toBe(3);
      expect(state.callLog.filter((s) => s.startsWith("xattr:"))).toHaveLength(3);

      // Release the 3 xattrs; each chain now issues spctl (still 3 in flight).
      releaseAll();
      await flushMicrotasks();
      expect(state.inFlight).toBe(3);
      expect(state.callLog.filter((s) => s.startsWith("spctl:"))).toHaveLength(3);

      // Drain rest.
      while (state.completedCalls < 2 * apps.length) {
        releaseAll();
        await flushMicrotasks();
        expect(state.inFlight).toBeLessThanOrEqual(3);
      }

      const result = await scanPromise;
      expect(result).toHaveLength(6);
      expect(result.every((a) => a.status === "quarantined")).toBe(true);
      expect(state.totalCalls).toBe(2 * apps.length); // xattr+spctl per app
    });

    it("dispatches apps in entry order via onProgress, even under concurrency", async () => {
      // With N=3 workers, the first 3 progress calls should be entries[0..2]
      // in order (worker i grabs slot i).
      const { exec, releaseAll, state } = makeInstrumentedExec();
      const apps = ["A.app", "B.app", "C.app", "D.app", "E.app", "F.app"];

      const progress: string[] = [];
      const scanPromise = listApps(exec, "/apps", apps, (n) => progress.push(n));

      await flushMicrotasks();
      // 3 workers started → first 3 progress calls, in order.
      expect(progress).toEqual(["A.app", "B.app", "C.app"]);

      // Drain and confirm the tail also fires in dispatch order.
      while (state.completedCalls < apps.length) {
        releaseAll();
        await flushMicrotasks();
      }
      await scanPromise;
      expect(progress).toEqual(apps);
    });

    it("does not spawn workers beyond the queue length", async () => {
      const { exec, state, releaseAll } = makeInstrumentedExec();
      // Only 2 apps but default concurrency is 3 — should cap at 2.
      const scanPromise = listApps(exec, "/apps", ["A.app", "B.app"]);

      await flushMicrotasks();
      expect(state.inFlight).toBe(2);

      releaseAll();
      await flushMicrotasks();
      await scanPromise;
      expect(state.peakInFlight).toBe(2);
    });

    it("clamps concurrency to at least 1 even when passed 0 or negative", async () => {
      const { exec, state, releaseAll } = makeInstrumentedExec();
      const apps = ["A.app", "B.app", "C.app"];

      const scanPromise = listApps(exec, "/apps", apps, undefined, {
        concurrency: 0,
      });

      // Even with 0 requested, one worker must run — otherwise nothing scans.
      await flushMicrotasks();
      expect(state.inFlight).toBe(1);
      expect(state.peakInFlight).toBe(1);

      // Drain — cap stays at 1 the whole way.
      while (state.completedCalls < apps.length) {
        releaseAll();
        await flushMicrotasks();
        expect(state.inFlight).toBeLessThanOrEqual(1);
      }
      const result = await scanPromise;
      expect(result).toHaveLength(3);
      expect(state.peakInFlight).toBe(1);
    });

    it("continues past a failing app without stalling other workers", async () => {
      // App at index 1 throws; other apps must still complete.
      let call = 0;
      const exec: Executor = async (_cmd, args) => {
        const path = args[args.length - 1] ?? "";
        call += 1;
        if (path === "/apps/Boom.app") {
          throw new Error("kaboom");
        }
        return { stdout: "", stderr: "", exitCode: 0 };
      };

      const result = await listApps(exec, "/apps", ["OK1.app", "Boom.app", "OK2.app", "OK3.app"]);

      expect(result).toHaveLength(4);
      const boom = result.find((a) => a.name === "Boom.app")!;
      expect(boom.status).toBe("unknown");
      expect(boom.error).toBe("kaboom");
      // The other three succeeded — the pool didn't jam on the failure.
      const oks = result.filter((a) => a.name !== "Boom.app");
      expect(oks.every((a) => a.status === "unsealed")).toBe(true);
      expect(call).toBe(4);
    });

    it("results are sorted alphabetically regardless of completion order", async () => {
      // Slow "A" and fast "Z" — under concurrency, Z would complete first.
      // Result must still be sorted A→Z.
      const finishers: Record<string, () => void> = {};
      const exec: Executor = (_cmd, args) => {
        const path = args[args.length - 1] ?? "";
        return new Promise((resolve) => {
          finishers[path] = () => resolve({ stdout: "", stderr: "", exitCode: 0 });
        });
      };

      const scanPromise = listApps(exec, "/apps", ["A.app", "M.app", "Z.app"]);

      // Wait for all three workers to register.
      await flushMicrotasks();
      // Finish out of order.
      finishers["/apps/Z.app"]?.();
      finishers["/apps/M.app"]?.();
      finishers["/apps/A.app"]?.();

      const result = await scanPromise;
      expect(result.map((a) => a.name)).toEqual(["A.app", "M.app", "Z.app"]);
    });

    it("preserves per-app result mapping when many chains interleave", async () => {
      // Half the apps have quarantine attr (→ spctl rejects → quarantined),
      // half don't (→ unsealed). Under concurrency the calls interleave,
      // so any bug that mixes up results by index would be visible.
      const quarantinedSet = new Set(["Q0.app", "Q1.app", "Q2.app", "Q3.app"]);
      const exec: Executor = async (cmd, args) => {
        const path = args[args.length - 1] ?? "";
        const name = path.split("/").pop() ?? "";
        if (cmd === "xattr") {
          return {
            stdout: quarantinedSet.has(name) ? "com.apple.quarantine: 0081" : "",
            stderr: "",
            exitCode: 0,
          };
        }
        // spctl — only ever called for the quarantined ones.
        return { stdout: "", stderr: "rejected", exitCode: 3 };
      };

      const apps = ["A.app", "Q0.app", "B.app", "Q1.app", "C.app", "Q2.app", "D.app", "Q3.app"];
      const result = await listApps(exec, "/apps", apps);

      for (const app of result) {
        const expected = quarantinedSet.has(app.name) ? "quarantined" : "unsealed";
        expect(app.status).toBe(expected);
      }
    });
  });
});
