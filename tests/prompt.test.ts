import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppInfo } from "../src/types.js";

// Mock @inquirer/prompts before importing prompt module
const { mockCheckbox } = vi.hoisted(() => ({
  mockCheckbox: vi.fn<(config: any) => Promise<any[]>>(),
}));

vi.mock("@inquirer/prompts", () => ({
  checkbox: mockCheckbox,
}));

// Import after mocking
const { selectApps } = await import("../src/prompt.js");

function makeApp(
  name: string,
  status: "quarantined" | "unsealed" | "unknown",
  error?: string,
): AppInfo {
  return { name: `${name}.app`, path: `/Applications/${name}.app`, status, error };
}

describe("prompt", () => {
  beforeEach(() => {
    mockCheckbox.mockClear();
  });

  describe("selectApps", () => {
    it("returns user-selected apps from checkbox", async () => {
      const q1 = makeApp("A", "quarantined");
      const q2 = makeApp("B", "quarantined");
      mockCheckbox.mockResolvedValueOnce([q1]);

      const result = await selectApps([q1, q2], [makeApp("C", "unsealed")], []);

      expect(result).toEqual([q1]);
      expect(mockCheckbox).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when user selects nothing", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      const result = await selectApps([makeApp("A", "quarantined")], [], []);

      expect(result).toEqual([]);
    });

    it("passes quarantined apps as checkbox choices with checked=true by default", async () => {
      const q1 = makeApp("X", "quarantined");
      const q2 = makeApp("Y", "quarantined");
      mockCheckbox.mockResolvedValueOnce([]);

      await selectApps([q1, q2], [], []);

      const config = mockCheckbox.mock.calls[0][0];
      expect(config.choices).toHaveLength(2);
      expect(config.choices[0].value).toEqual(q1);
      expect(config.choices[1].value).toEqual(q2);
      expect(config.choices[0].checked).toBe(true);
      expect(config.choices[1].checked).toBe(true);
    });

    it("customises the checkbox theme icons to widen the cursor↔circle gap", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      await selectApps([makeApp("A", "quarantined")], [], []);

      const config = mockCheckbox.mock.calls[0][0];
      // Both icons carry a leading space to visually separate them from the cursor.
      expect(config.theme.icon.checked.endsWith("◉")).toBe(true);
      expect(
        config.theme.icon.checked.startsWith(" ") || /\s◉$/.test(config.theme.icon.checked),
      ).toBe(true);
      expect(config.theme.icon.unchecked).toMatch(/^\s+◯$/);
      expect(config.theme.icon.cursor).toBe("❯");
    });

    it("handles unknown status apps in display", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      const result = await selectApps(
        [makeApp("A", "quarantined")],
        [makeApp("B", "unsealed")],
        [makeApp("C", "unknown", "permission denied")],
      );

      expect(result).toEqual([]);
      expect(mockCheckbox).toHaveBeenCalledTimes(1);
    });

    it("falls back to 'unknown error' when an unknown app has no error message", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      const result = await selectApps(
        [],
        [],
        // No `error` property — exercises the `?? "unknown error"` branch.
        [makeApp("Mystery", "unknown")],
      );

      expect(result).toEqual([]);
    });
  });
});
