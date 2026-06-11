import { describe, it, expect } from "vitest";
import { Throttle } from "./throttle.js";

describe("Throttle", () => {
  it("blocks an IP after 5 attempts within the window", () => {
    const t = new Throttle();
    for (let i = 0; i < 5; i++) expect(t.checkIp("1.2.3.4", i * 1000)).toBe(true);
    expect(t.checkIp("1.2.3.4", 5000)).toBe(false);
  });

  it("unblocks the IP after the 15 minute block elapses", () => {
    const t = new Throttle();
    for (let i = 0; i < 6; i++) t.checkIp("1.2.3.4", 0);
    expect(t.checkIp("1.2.3.4", 0)).toBe(false);
    expect(t.checkIp("1.2.3.4", 15 * 60_000 + 1)).toBe(true);
  });

  it("locks a username after 5 failures and a success clears it", () => {
    const t = new Throttle();
    for (let i = 0; i < 5; i++) t.recordFailure("odin", 0);
    expect(t.isLocked("odin", 0)).toBe(true);
    expect(t.isLocked("odin", 10 * 60_000 + 1)).toBe(false);
    t.recordFailure("odin", 0);
    t.recordSuccess("odin");
    expect(t.isLocked("odin", 0)).toBe(false);
  });
});
