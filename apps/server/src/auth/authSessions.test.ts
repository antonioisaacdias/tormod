import { describe, it, expect } from "vitest";
import { AuthSessionStore } from "./authSessions.js";

describe("AuthSessionStore", () => {
  it("issues a session that validates, then expires", () => {
    const s = AuthSessionStore.open(":memory:", 1); // 1-day ttl
    const { id, expiresAt } = s.issue(0);
    expect(id.length).toBeGreaterThan(20);
    expect(s.validate(id, 0)).toBe(true);
    expect(s.validate(id, expiresAt + 1)).toBe(false);
  });

  it("never stores the raw id", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const { id } = s.issue(0);
    expect(s.debugStoredKeys()).not.toContain(id);
  });

  it("revokes a session", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const { id } = s.issue(0);
    s.revoke(id);
    expect(s.validate(id, 0)).toBe(false);
  });

  it("revokeAll invalidates every session", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    const a = s.issue(0);
    const b = s.issue(0);
    s.revokeAll();
    expect(s.validate(a.id, 0)).toBe(false);
    expect(s.validate(b.id, 0)).toBe(false);
  });

  it("rejects an unknown id", () => {
    const s = AuthSessionStore.open(":memory:", 1);
    expect(s.validate("nope", 0)).toBe(false);
  });
});
