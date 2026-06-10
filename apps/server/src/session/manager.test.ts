import { describe, it, expect } from "vitest";
import { SessionManager } from "./manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";
import { SettingsStore } from "../settings/store.js";
import type { ServerEvent } from "./events.js";

function setup() {
  const fake = new FakeBrainAdapter();
  const audit = Audit.open(":memory:");
  const mgr = new SessionManager(fake, audit);
  return { fake, audit, mgr };
}

describe("SessionManager — lifecycle", () => {
  it("creates and lists a live session", async () => {
    const { mgr } = setup();
    const s = await mgr.createSession({ title: "test" });
    expect(s.status).toBe("live");
    expect(mgr.list().map((x) => x.id)).toContain(s.id);
  });

  it("close marks the session closed", async () => {
    const { mgr } = setup();
    const s = await mgr.createSession({});
    await mgr.close(s.id);
    expect(mgr.list().find((x) => x.id === s.id)!.status).toBe("closed");
  });

  it("sending to a closed session resumes it (back to live)", async () => {
    const { mgr } = setup();
    const s = await mgr.createSession({});
    await mgr.close(s.id);
    await mgr.send(s.id, "continua aí");
    expect(mgr.list().find((x) => x.id === s.id)!.status).toBe("live");
  });

  it("sending to an unknown session does not throw", async () => {
    const { mgr } = setup();
    await expect(mgr.send("ghost", "x")).resolves.toBeUndefined();
  });

  it("broadcasts session_status working then idle across a turn", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const statuses: string[] = [];
    mgr.subscribeAll((e) => {
      if (e.type === "session_status" && e.id === s.id) statuses.push(e.status);
    });
    fake.script([{ type: "text", text: "oi" }, { type: "result", ok: true }]);
    await mgr.send(s.id, "hi");
    expect(statuses).toContain("working");
    expect(statuses[statuses.length - 1]).toBe("idle");
  });

  it("broadcasts session_status waiting on a pending approval", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const statuses: string[] = [];
    mgr.subscribeAll((e) => {
      if (e.type === "session_status" && e.id === s.id) statuses.push(e.status);
    });
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } }]);
    const sending = mgr.send(s.id, "edit");
    await new Promise((r) => setTimeout(r, 0));
    expect(statuses).toContain("waiting");
    mgr.resolveDecision("t1", true);
    await sending;
  });

  it("stamps lastActivityAt on create and bumps it on send", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const created = mgr.list().find((x) => x.id === s.id)!.lastActivityAt;
    expect(created).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    fake.script([{ type: "text", text: "x" }, { type: "result", ok: true }]);
    await mgr.send(s.id, "hi");
    const after = mgr.list().find((x) => x.id === s.id)!.lastActivityAt;
    expect(after >= created!).toBe(true);
  });

  it("applies default model/effort from settings on create", async () => {
    const audit = Audit.open(":memory:");
    const settings = SettingsStore.open(":memory:");
    settings.save({ defaultModel: "opus", defaultEffort: "high" });
    let captured: { model?: string; effort?: string } | undefined;
    const fake = new FakeBrainAdapter();
    const orig = fake.startSession.bind(fake);
    fake.startSession = (opts) => { captured = opts; return orig(opts); };
    const mgr = new SessionManager(fake, audit, undefined, settings);
    await mgr.createSession({});
    expect(captured?.model).toBe("claude-opus-4-8");
    expect(captured?.effort).toBe("high");
  });

  it("closes the longest-idle session when over the cap", async () => {
    const audit = Audit.open(":memory:");
    const settings = SettingsStore.open(":memory:");
    settings.save({ maxLiveSessions: 2 });
    const mgr = new SessionManager(new FakeBrainAdapter(), audit, undefined, settings);
    const a = await mgr.createSession({ title: "a" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await mgr.createSession({ title: "b" });
    await new Promise((r) => setTimeout(r, 5));
    const c = await mgr.createSession({ title: "c" }); // exceeds cap of 2
    const live = mgr.list().filter((s) => s.status === "live").map((s) => s.id);
    expect(live).not.toContain(a.id); // oldest-idle closed
    expect(live).toEqual(expect.arrayContaining([b.id, c.id]));
    expect(live.length).toBe(2);
  });

  it("sweepIdle closes sessions idle beyond idleCloseHours and respects 0=off", async () => {
    const audit = Audit.open(":memory:");
    const settings = SettingsStore.open(":memory:");
    settings.save({ idleCloseHours: 1 });
    const mgr = new SessionManager(new FakeBrainAdapter(), audit, undefined, settings);
    const a = await mgr.createSession({ title: "a" });
    const meta = mgr.list().find((s) => s.id === a.id)!;
    (meta as { lastActivityAt: string }).lastActivityAt = new Date(Date.now() - 2 * 3600_000).toISOString();
    await mgr.sweepIdle();
    expect(mgr.list().find((s) => s.id === a.id)!.status).toBe("closed");

    settings.save({ idleCloseHours: 0 });
    const b = await mgr.createSession({ title: "b" });
    const mb = mgr.list().find((s) => s.id === b.id)!;
    (mb as { lastActivityAt: string }).lastActivityAt = new Date(Date.now() - 99 * 3600_000).toISOString();
    await mgr.sweepIdle();
    expect(mgr.list().find((s) => s.id === b.id)!.status).toBe("live");
    mgr.dispose();
  });

  it("does not close a working session to honor the cap", async () => {
    const audit = Audit.open(":memory:");
    const settings = SettingsStore.open(":memory:");
    settings.save({ maxLiveSessions: 1 });
    const fake = new FakeBrainAdapter();
    const mgr = new SessionManager(fake, audit, undefined, settings);
    const a = await mgr.createSession({ title: "a" });
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } }]);
    void mgr.send(a.id, "edit"); // parks on the approval card -> 'a' becomes waiting (active)
    await new Promise((r) => setTimeout(r, 0));
    const b = await mgr.createSession({ title: "b" }); // cap=1 but 'a' is active
    const live = mgr.list().filter((s) => s.status === "live").map((s) => s.id);
    expect(live).toEqual(expect.arrayContaining([a.id, b.id])); // temporary over-cap
    mgr.resolveDecision("t1", true);
  });
});

describe("SessionManager — streaming + auto/deny classification", () => {
  it("auto tool resolves without a permission_request", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "df -h" } } }]);
    await mgr.send(s.id, "check disk");
    expect(got.some((e) => e.type === "permission_request")).toBe(false);
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: true });
  });

  it("destructive tool is denied without a card", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "rm -rf /" } } }]);
    await mgr.send(s.id, "go");
    expect(got.some((e) => e.type === "permission_request")).toBe(false);
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });
});

describe("SessionManager — approval bridge", () => {
  it("approve tool parks until resolveDecision(allow)", async () => {
    const { fake, mgr, audit } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } }]);

    const sending = mgr.send(s.id, "edit");
    await new Promise((r) => setTimeout(r, 0));
    const req = got.find((e) => e.type === "permission_request");
    expect(req).toBeDefined();

    mgr.resolveDecision("t1", true);
    await sending;

    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: true });
    expect(got.some((e) => e.type === "permission_resolved")).toBe(true);
    expect(audit.query({ tier: "mutate" }).length).toBe(1);
  });

  it("resolveDecision(false) denies the parked request", async () => {
    const { fake, mgr } = setup();
    const s = await mgr.createSession({});
    const got: ServerEvent[] = [];
    mgr.subscribe(s.id, (e) => got.push(e));
    fake.script([{ type: "tool_use", id: "t1", request: { tool: "Write", input: { file_path: "/x" } } }]);
    const sending = mgr.send(s.id, "write");
    await new Promise((r) => setTimeout(r, 0));
    mgr.resolveDecision("t1", false);
    await sending;
    expect(got.find((e) => e.type === "tool_result")).toMatchObject({ ok: false });
  });
});
