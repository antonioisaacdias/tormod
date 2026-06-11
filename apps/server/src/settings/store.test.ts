import { describe, it, expect } from "vitest";
import { SettingsStore, DEFAULTS } from "./store.js";

describe("SettingsStore", () => {
  it("returns defaults when empty", () => {
    const s = SettingsStore.open(":memory:");
    expect(s.get()).toEqual(DEFAULTS);
  });

  it("saves a partial patch and merges over current", () => {
    const s = SettingsStore.open(":memory:");
    const saved = s.save({ maxLiveSessions: 3, defaultModel: "opus" });
    expect(saved.maxLiveSessions).toBe(3);
    expect(saved.defaultModel).toBe("opus");
    expect(saved.idleCloseHours).toBe(DEFAULTS.idleCloseHours);
    expect(saved.defaultEffort).toBe(DEFAULTS.defaultEffort);
    expect(s.get()).toEqual(saved);
  });

  it("clamps numbers and rejects invalid enums to defaults", () => {
    const s = SettingsStore.open(":memory:");
    expect(s.save({ maxLiveSessions: 0 }).maxLiveSessions).toBe(1);
    expect(s.save({ maxLiveSessions: 999 }).maxLiveSessions).toBe(50);
    expect(s.save({ idleCloseHours: -5 }).idleCloseHours).toBe(0);
    expect(s.save({ idleCloseHours: 9999 }).idleCloseHours).toBe(168);
    expect(s.save({ defaultModel: "bogus" as never }).defaultModel).toBe(DEFAULTS.defaultModel);
    expect(s.save({ defaultEffort: "bogus" as never }).defaultEffort).toBe(DEFAULTS.defaultEffort);
  });

  it("defaults permission mode to 'default' and accepts 'auto', rejecting others", () => {
    const s = SettingsStore.open(":memory:");
    expect(s.get().defaultPermissionMode).toBe("default");
    expect(s.save({ defaultPermissionMode: "auto" }).defaultPermissionMode).toBe("auto");
    expect(s.save({ defaultPermissionMode: "bogus" as never }).defaultPermissionMode).toBe(DEFAULTS.defaultPermissionMode);
  });
});
