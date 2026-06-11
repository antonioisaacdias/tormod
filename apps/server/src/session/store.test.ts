import { describe, it, expect } from "vitest";
import { SessionStore } from "./store.js";

describe("SessionStore", () => {
  it("persists, lists, and updates sessions", () => {
    const store = SessionStore.open(":memory:");

    store.upsert({ id: "s1", title: "uma", cwd: "/home/odin", status: "live", createdAt: "2026-06-10T00:00:00Z", lastActivityAt: "2026-06-10T00:00:00Z" });
    store.upsert({ id: "s2", title: "duas", status: "live", createdAt: "2026-06-10T00:01:00Z", lastActivityAt: "2026-06-10T00:01:00Z" });

    expect(store.all().map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(store.all()[0]).toMatchObject({ id: "s1", title: "uma", cwd: "/home/odin", status: "live" });

    store.setClaudeId("s1", "claude-abc");
    store.setStatus("s1", "closed");
    const s1 = store.all().find((s) => s.id === "s1");
    expect(s1?.claudeId).toBe("claude-abc");
    expect(s1?.status).toBe("closed");

    store.remove("s2");
    expect(store.all().map((s) => s.id)).toEqual(["s1"]);
  });

  it("upsert updates an existing row without losing the Claude id", () => {
    const store = SessionStore.open(":memory:");
    store.upsert({ id: "s1", title: "v1", status: "live", createdAt: "t0", lastActivityAt: "t0" });
    store.setClaudeId("s1", "c1");
    store.upsert({ id: "s1", title: "v2", status: "closed", createdAt: "t0", lastActivityAt: "t0" });
    const s1 = store.all()[0];
    expect(s1?.title).toBe("v2");
    expect(s1?.status).toBe("closed");
    expect(s1?.claudeId).toBe("c1");
  });

  it("persists and updates lastActivityAt", () => {
    const store = SessionStore.open(":memory:");
    store.upsert({ id: "s1", title: "uma", status: "live", createdAt: "t0", lastActivityAt: "t0" });
    expect(store.all()[0]?.lastActivityAt).toBe("t0");
    store.setActivity("s1", "t1");
    expect(store.all()[0]?.lastActivityAt).toBe("t1");
  });

  it("persists and round-trips the usage snapshot", () => {
    const store = SessionStore.open(":memory:");
    store.upsert({ id: "s1", title: "uma", status: "live", createdAt: "t0", lastActivityAt: "t0" });
    expect(store.all()[0]?.usage).toBeUndefined();

    store.setUsage("s1", { model: "claude-opus-4-8", contextTokens: 45000, contextWindow: 1_000_000 });
    expect(store.all()[0]?.usage).toEqual({ model: "claude-opus-4-8", contextTokens: 45000, contextWindow: 1_000_000 });

    store.upsert({ id: "s1", title: "v2", status: "closed", createdAt: "t0", lastActivityAt: "t1" });
    expect(store.all()[0]?.usage).toEqual({ model: "claude-opus-4-8", contextTokens: 45000, contextWindow: 1_000_000 });
  });
});
