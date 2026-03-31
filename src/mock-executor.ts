import type { Executor } from "./exec.js";

/**
 * Mock executor that returns canned responses for system commands.
 * Activated when UNSEAL_MOCK=1 is set.
 */
export function createMockExecutor(): Executor {
  return async (cmd, args) => {
    // xattr -l <path> — simulate no quarantine (all apps unsealed)
    if (cmd === "xattr" && args[0] === "-l") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // xattr -rd com.apple.quarantine <path> — simulate successful removal
    if (cmd === "xattr" && args[0] === "-rd") {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // spctl --assess --type execute <path> — simulate Gatekeeper rejection
    // Exit code 3 = app is not signed / notarized, so it stays quarantined.
    if (cmd === "spctl" && args[0] === "--assess") {
      return { stdout: "", stderr: "rejected\nsource=no signature", exitCode: 3 };
    }

    // sudo -n true — simulate passwordless sudo available
    if (cmd === "sudo" && args.includes("-n")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    // sudo -v — simulate successful sudo validation
    if (cmd === "sudo" && args.includes("-v")) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }

    return { stdout: "", stderr: `Unknown mock command: ${cmd}`, exitCode: 1 };
  };
}
