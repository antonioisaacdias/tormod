import { describe, it, expect } from "vitest";
import { createApp } from "./app.js";
import { SessionManager } from "../session/manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";

function app() {
  const mgr = new SessionManager(new FakeBrainAdapter(), Audit.open(":memory:"));
  return createApp(mgr, { token: "secret" });
}
const auth = { Authorization: "Bearer secret" };

describe("createApp — auth", () => {
  it("rejects requests without a token", async () => {
    const res = await app().request("/api/sessions", { method: "GET" });
    expect(res.status).toBe(401);
  });
  it("accepts requests with the token", async () => {
    const res = await app().request("/api/sessions", { headers: auth });
    expect(res.status).toBe(200);
  });
});

describe("createApp — sessions", () => {
  it("creates then lists a session", async () => {
    const a = app();
    const created = await a.request("/api/sessions", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "hi" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    expect(id).toMatch(/.+/);

    const listed = await a.request("/api/sessions", { headers: auth });
    const sessions = (await listed.json()) as Array<{ id: string }>;
    expect(sessions.map((s) => s.id)).toContain(id);
  });

  it("posting a message returns 202", async () => {
    const a = app();
    const created = await a.request("/api/sessions", {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: "{}",
    });
    const { id } = (await created.json()) as { id: string };
    const res = await a.request(`/api/sessions/${id}/messages`, {
      method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(202);
  });
});
