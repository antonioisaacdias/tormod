import { describe, it, expect } from "vitest";
import { FakeBrainAdapter } from "./fake.js";
import type { BrainEvent } from "./adapter.js";

describe("FakeBrainAdapter", () => {
  it("startSession returns an id and emits a result on a scripted turn", async () => {
    const fake = new FakeBrainAdapter();
    const events: Array<{ s: string; e: BrainEvent }> = [];
    fake.onEvent((s, e) => events.push({ s, e }));

    const id = await fake.startSession({});
    expect(id).toMatch(/.+/);

    fake.script([{ type: "text", text: "hello" }, { type: "result", ok: true }]);
    await fake.sendMessage(id, "hi");

    expect(events.map((x) => x.e.type)).toEqual(["text", "result"]);
    expect(events.every((x) => x.s === id)).toBe(true);
  });

  it("a scripted tool_use invokes the permission handler and respects allow", async () => {
    const fake = new FakeBrainAdapter();
    const calls: string[] = [];
    fake.onPermissionRequest(async (_sessionId, req) => {
      calls.push(req.tool);
      return { allow: true };
    });
    const results: boolean[] = [];
    fake.onEvent((_s, e) => {
      if (e.type === "tool_result") results.push(e.ok);
    });

    const id = await fake.startSession({});
    fake.script([
      { type: "tool_use", id: "t1", request: { tool: "Edit", input: { file_path: "/x" } } },
    ]);
    await fake.sendMessage(id, "edit it");

    expect(calls).toEqual(["Edit"]);
    expect(results).toEqual([true]);
  });

  it("denied permission yields a failed tool_result", async () => {
    const fake = new FakeBrainAdapter();
    fake.onPermissionRequest(async (_sessionId) => ({ allow: false, message: "nope" }));
    const results: boolean[] = [];
    fake.onEvent((_s, e) => {
      if (e.type === "tool_result") results.push(e.ok);
    });

    const id = await fake.startSession({});
    fake.script([
      { type: "tool_use", id: "t1", request: { tool: "Bash", input: { command: "rm -rf /" } } },
    ]);
    await fake.sendMessage(id, "go");

    expect(results).toEqual([false]);
  });
});
