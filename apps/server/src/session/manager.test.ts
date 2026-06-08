import { describe, it, expect } from "vitest";
import { SessionManager } from "./manager.js";
import { FakeBrainAdapter } from "../brain/fake.js";
import { Audit } from "../audit/audit.js";
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
