import { describe, it, expect, mock, beforeEach } from "bun:test";
import type { AppInfo } from "../src/types.js";

// Mock @inquirer/prompts before importing prompt module
const mockCheckbox = mock<(config: any) => Promise<any[]>>();
const mockConfirm = mock<(config: any) => Promise<boolean>>();

mock.module("@inquirer/prompts", () => ({
  checkbox: mockCheckbox,
  confirm: mockConfirm,
}));

// Import after mocking
const { selectApps, confirmUnseal } = await import("../src/prompt.js");

function makeApp(
  name: string,
  status: "quarantined" | "unsealed" | "unknown",
  error?: string
): AppInfo {
  return { name: `${name}.app`, path: `/Applications/${name}.app`, status, error };
}

describe("prompt", () => {
  beforeEach(() => {
    mockCheckbox.mockClear();
    mockConfirm.mockClear();
  });

  describe("selectApps", () => {
    it("returns user-selected apps from checkbox", async () => {
      const q1 = makeApp("A", "quarantined");
      const q2 = makeApp("B", "quarantined");
      mockCheckbox.mockResolvedValueOnce([q1]);

      const result = await selectApps(
        [q1, q2],
        [makeApp("C", "unsealed")],
        []
      );

      expect(result).toEqual([q1]);
      expect(mockCheckbox).toHaveBeenCalledTimes(1);
    });

    it("returns empty array when user selects nothing", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      const result = await selectApps(
        [makeApp("A", "quarantined")],
        [],
        []
      );

      expect(result).toEqual([]);
    });

    it("passes quarantined apps as checkbox choices", async () => {
      const q1 = makeApp("X", "quarantined");
      const q2 = makeApp("Y", "quarantined");
      mockCheckbox.mockResolvedValueOnce([]);

      await selectApps(q1.status === "quarantined" ? [q1, q2] : [], [], []);

      const config = mockCheckbox.mock.calls[0][0];
      expect(config.choices).toHaveLength(2);
      expect(config.choices[0].value).toEqual(q1);
      expect(config.choices[1].value).toEqual(q2);
    });

    it("handles unknown status apps in display", async () => {
      mockCheckbox.mockResolvedValueOnce([]);

      const result = await selectApps(
        [makeApp("A", "quarantined")],
        [makeApp("B", "unsealed")],
        [makeApp("C", "unknown", "permission denied")]
      );

      expect(result).toEqual([]);
      expect(mockCheckbox).toHaveBeenCalledTimes(1);
    });
  });

  describe("confirmUnseal", () => {
    it("returns true when user confirms", async () => {
      mockConfirm.mockResolvedValueOnce(true);

      const result = await confirmUnseal([makeApp("A", "quarantined")]);

      expect(result).toBe(true);
      expect(mockConfirm).toHaveBeenCalledTimes(1);
    });

    it("returns false when user declines", async () => {
      mockConfirm.mockResolvedValueOnce(false);

      const result = await confirmUnseal([makeApp("A", "quarantined")]);

      expect(result).toBe(false);
    });
  });
});
