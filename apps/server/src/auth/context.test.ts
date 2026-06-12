import { describe, it, expect } from "vitest";
import { authConfigFromEnv } from "./context.js";

describe("authConfigFromEnv", () => {
  it("applies defaults when env is empty", () => {
    const c = authConfigFromEnv({});
    expect(c.trustedProxy).toBeNull();
    expect(c.trustedCidrs).toContain("192.168.0.0/24");
    expect(c.trustedCidrs).toContain("10.0.0.0/24");
    expect(c.cookieSecure).toBe(true);
    expect(c.sessionTtlDays).toBe(30);
  });

  it("reads overrides", () => {
    const c = authConfigFromEnv({
      TORMOD_TRUSTED_PROXY: "10.0.0.1",
      TORMOD_TRUSTED_CIDRS: "172.16.0.0/12",
      TORMOD_COOKIE_SECURE: "false",
      TORMOD_SESSION_TTL_DAYS: "7",
    });
    expect(c.trustedProxy).toBe("10.0.0.1");
    expect(c.trustedCidrs).toEqual(["172.16.0.0/12"]);
    expect(c.cookieSecure).toBe(false);
    expect(c.sessionTtlDays).toBe(7);
  });
});
