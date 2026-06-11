import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes to an argon2id string and verifies the correct password", async () => {
    const h = await hashPassword("correct horse");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(h, "correct horse")).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const h = await hashPassword("correct horse");
    expect(await verifyPassword(h, "battery staple")).toBe(false);
  });

  it("returns false on a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
  });
});
