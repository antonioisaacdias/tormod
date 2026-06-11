import { describe, it, expect } from "vitest";
import { UserStore } from "./users.js";

describe("UserStore", () => {
  it("reports no user, then a user after create", () => {
    const s = UserStore.open(":memory:");
    expect(s.hasUser()).toBe(false);
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(s.hasUser()).toBe(true);
  });

  it("returns credentials for the single user", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    const c = s.getCredentials();
    expect(c).toEqual({ username: "odin", passwordHash: "$argon2id$h", totpSecret: null, totpEnabled: false });
  });

  it("returns the public profile", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(s.profile()).toEqual({ username: "odin", email: "o@x.dev", totpEnabled: false });
  });

  it("sets a pending totp secret then enables and disables it", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    s.setTotpSecret("SECRET");
    expect(s.getCredentials()!.totpSecret).toBe("SECRET");
    expect(s.getCredentials()!.totpEnabled).toBe(false);
    s.enableTotp();
    expect(s.getCredentials()!.totpEnabled).toBe(true);
    s.disableTotp();
    expect(s.getCredentials()).toMatchObject({ totpSecret: null, totpEnabled: false });
  });

  it("rejects a second user", () => {
    const s = UserStore.open(":memory:");
    s.create({ username: "odin", email: "o@x.dev", passwordHash: "$argon2id$h" });
    expect(() => s.create({ username: "loki", email: "l@x.dev", passwordHash: "$argon2id$h2" })).toThrow();
  });
});
