import { describe, it, expect } from "vitest";
import type { SDKMessage, SDKUserMessage, SessionMessage, Options } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeCodeAdapter, type QueryFn, type QueryLike } from "./claude.js";
import type { BrainEvent } from "./adapter.js";

/** A scripted step the fake brain performs on each user turn. */
type Step =
  | { kind: "text"; text: string }
  | { kind: "tool"; toolUseId: string; tool: string; input: Record<string, unknown> }
  | { kind: "result"; ok: boolean; costUsd?: number };

const initMsg = (id: string, model = "claude-opus-4-8"): SDKMessage =>
  ({ type: "system", subtype: "init", session_id: id, model }) as unknown as SDKMessage;

const rateLimitMsg = (
  id: string,
  rateLimitType: "five_hour" | "seven_day",
  utilization: number,
): SDKMessage =>
  ({
    type: "rate_limit_event",
    session_id: id,
    rate_limit_info: { status: "allowed", rateLimitType, utilization },
  }) as unknown as SDKMessage;

const assistantText = (id: string, text: string): SDKMessage =>
  ({
    type: "assistant",
    session_id: id,
    message: { role: "assistant", content: [{ type: "text", text }] },
  }) as unknown as SDKMessage;

const assistantToolUse = (
  id: string,
  toolUseId: string,
  tool: string,
  input: Record<string, unknown>,
): SDKMessage =>
  ({
    type: "assistant",
    session_id: id,
    message: { role: "assistant", content: [{ type: "tool_use", id: toolUseId, name: tool, input }] },
  }) as unknown as SDKMessage;

const toolResultMsg = (id: string, toolUseId: string, ok: boolean, text: string): SDKMessage =>
  ({
    type: "user",
    session_id: id,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolUseId, is_error: !ok, content: text }],
    },
  }) as unknown as SDKMessage;

const streamTextDelta = (id: string, text: string): SDKMessage =>
  ({
    type: "stream_event",
    session_id: id,
    event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  }) as unknown as SDKMessage;

const streamThinkingDelta = (id: string, thinking: string): SDKMessage =>
  ({
    type: "stream_event",
    session_id: id,
    event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking } },
  }) as unknown as SDKMessage;

const resultMsg = (id: string, ok: boolean, costUsd: number): SDKMessage =>
  ({
    type: "result",
    subtype: ok ? "success" : "error_during_execution",
    session_id: id,
    is_error: !ok,
    total_cost_usd: costUsd,
  }) as unknown as SDKMessage;

/**
 * A fake `query` that mimics the SDK flow: emits an init message, then for each
 * user message pushed into the prompt stream, runs a scripted turn. Tool steps
 * invoke the real `canUseTool` from options (the permission bridge under test)
 * and emit a tool_result reflecting the allow/deny decision.
 */
function fakeQuery(initId: string, turns: Step[][]): QueryFn {
  let turnIdx = 0;
  return (params: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }): QueryLike => {
    const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
      yield initMsg(initId);
      for await (const _user of params.prompt) {
        const steps = turns[turnIdx++] ?? [];
        for (const step of steps) {
          if (step.kind === "text") {
            yield assistantText(initId, step.text);
          } else if (step.kind === "result") {
            yield resultMsg(initId, step.ok, step.costUsd ?? 0);
          } else {
            yield assistantToolUse(initId, step.toolUseId, step.tool, step.input);
            const canUse = params.options?.canUseTool;
            const decision = canUse
              ? await canUse(step.tool, step.input, {
                  signal: new AbortController().signal,
                  toolUseID: step.toolUseId,
                })
              : { behavior: "deny" as const, message: "no handler" };
            const ok = decision.behavior === "allow";
            yield toolResultMsg(initId, step.toolUseId, ok, ok ? "ran" : "denied");
          }
        }
      }
    })();
    return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
  };
}

describe("ClaudeCodeAdapter", () => {
  it("startSession resolves with the init session id and streams text + result", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("sess-1", [[{ kind: "text", text: "olá" }, { kind: "result", ok: true, costUsd: 0.01 }]]),
    });
    const events: Array<{ s: string; e: BrainEvent }> = [];
    adapter.onEvent((s, e) => events.push({ s, e }));

    const id = await adapter.startSession({});
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    await adapter.sendMessage(id, "oi");
    await new Promise((r) => setTimeout(r, 10));

    expect(events.map((x) => x.e.type)).toEqual(["usage", "text", "result"]);
    expect(events.every((x) => x.s === id)).toBe(true);
    const usage = events[0]?.e;
    expect(usage?.type === "usage" && usage.model).toBe("claude-opus-4-8");
    const text = events[1]?.e;
    expect(text?.type === "text" && text.text).toBe("olá");
    const res = events[2]?.e;
    expect(res?.type === "result" && res.ok).toBe(true);
    expect(res?.type === "result" && res.costUsd).toBe(0.01);
  });

  it("emits usage from init (model), rate-limit events, and context on result", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("u1", "claude-opus-4-8");
          for await (const _u of params.prompt) {
            yield rateLimitMsg("u1", "five_hour", 0.5);
            yield rateLimitMsg("u1", "seven_day", 0.2);
            yield resultMsg("u1", true, 0.03);
          }
        })();
        return Object.assign(gen, {
          interrupt: async () => void (await gen.return()),
          getContextUsage: async () => ({ totalTokens: 1234, maxTokens: 200000, model: "claude-opus-4-8" }),
        });
      },
    });
    const usage: Array<Record<string, unknown>> = [];
    adapter.onEvent((_s, e) => {
      if (e.type === "usage") usage.push(e as unknown as Record<string, unknown>);
    });

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "vai");
    await new Promise((r) => setTimeout(r, 20));

    const merged = Object.assign({}, ...usage);
    expect(merged.model).toBe("claude-opus-4-8");
    expect(merged.fiveHourPct).toBe(50);
    expect(merged.sevenDayPct).toBe(20);
    expect(merged.contextTokens).toBe(1234);
    expect(merged.contextWindow).toBe(200000);
  });

  it("routes a tool use through the permission handler and allows it", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("sess-2", [
        [{ kind: "tool", toolUseId: "t1", tool: "Edit", input: { file_path: "/x" } }],
      ]),
    });
    const seen: Array<{ tool: string; toolUseId: string }> = [];
    adapter.onPermissionRequest(async (_s, req, toolUseId) => {
      seen.push({ tool: req.tool, toolUseId });
      return { allow: true };
    });
    const events: BrainEvent[] = [];
    adapter.onEvent((_s, e) => events.push(e));

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "edit it");
    await new Promise((r) => setTimeout(r, 10));

    expect(seen).toEqual([{ tool: "Edit", toolUseId: "t1" }]);
    const toolUse = events.find((e) => e.type === "tool_use");
    expect(toolUse?.type === "tool_use" && toolUse.request.tool).toBe("Edit");
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.ok).toBe(true);
  });

  it("denied permission yields a failed tool_result with no execution", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("sess-3", [
        [{ kind: "tool", toolUseId: "t9", tool: "Bash", input: { command: "rm -rf /" } }],
      ]),
    });
    adapter.onPermissionRequest(async () => ({ allow: false, message: "blocked" }));
    const results: boolean[] = [];
    adapter.onEvent((_s, e) => {
      if (e.type === "tool_result") results.push(e.ok);
    });

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "go");
    await new Promise((r) => setTimeout(r, 10));

    expect(results).toEqual([false]);
  });

  it("denies tool use when no permission handler is registered", async () => {
    const decisions: boolean[] = [];
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("sess-4");
          for await (const _u of params.prompt) {
            const decision = await params.options!.canUseTool!("Bash", { command: "ls" }, {
              signal: new AbortController().signal,
              toolUseID: "tx",
            });
            decisions.push(decision.behavior === "allow");
            yield resultMsg("sess-4", true, 0);
          }
        })();
        return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
      },
    });

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "go");
    await new Promise((r) => setTimeout(r, 10));

    expect(decisions).toEqual([false]);
  });

  it("handles multiple turns on one live session", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("sess-5", [
        [{ kind: "text", text: "um" }, { kind: "result", ok: true }],
        [{ kind: "text", text: "dois" }, { kind: "result", ok: true }],
      ]),
    });
    const texts: string[] = [];
    adapter.onEvent((_s, e) => {
      if (e.type === "text") texts.push(e.text);
    });

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "a");
    await new Promise((r) => setTimeout(r, 10));
    await adapter.sendMessage(id, "b");
    await new Promise((r) => setTimeout(r, 10));

    expect(texts).toEqual(["um", "dois"]);
  });

  it("close tears down the session and stops further sends", async () => {
    let interrupted = false;
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("sess-6");
          for await (const _u of params.prompt) {
            yield resultMsg("sess-6", true, 0);
          }
        })();
        return Object.assign(gen, {
          interrupt: async () => {
            interrupted = true;
            await gen.return();
          },
        });
      },
    });

    const id = await adapter.startSession({});
    await adapter.close(id);

    expect(interrupted).toBe(true);
    await expect(adapter.sendMessage(id, "late")).rejects.toThrow(/unknown session/);
  });

  it("in streaming mode emits thinking + text deltas and does not double the final text", async () => {
    const adapter = new ClaudeCodeAdapter({
      streaming: true,
      queryFn: (params) => {
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("s1");
          for await (const _u of params.prompt) {
            yield streamThinkingDelta("s1", "hmm");
            yield streamTextDelta("s1", "ba");
            yield streamTextDelta("s1", "nana");
            yield assistantText("s1", "banana"); // final full message — must NOT re-emit text
            yield resultMsg("s1", true, 0);
          }
        })();
        return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
      },
    });
    const events: BrainEvent[] = [];
    adapter.onEvent((_s, e) => events.push(e));

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "go");
    await new Promise((r) => setTimeout(r, 20));

    expect(events.map((e) => e.type)).toEqual(["usage", "thinking", "text", "text", "result"]);
    const thinking = events[1];
    expect(thinking?.type === "thinking" && thinking.text).toBe("hmm");
    expect(events.filter((e) => e.type === "text").map((e) => (e.type === "text" ? e.text : ""))).toEqual(["ba", "nana"]);
  });

  it("denies AskUserQuestion without hitting the permission handler (steer inline)", async () => {
    let handlerCalled = false;
    let decision: { behavior: string; message?: string } | undefined;
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("aq1");
          for await (const _u of params.prompt) {
            decision = await params.options!.canUseTool!("AskUserQuestion", { questions: [] }, {
              signal: new AbortController().signal,
              toolUseID: "q1",
            });
            yield resultMsg("aq1", true, 0);
          }
        })();
        return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
      },
    });
    adapter.onPermissionRequest(async () => {
      handlerCalled = true;
      return { allow: true };
    });

    const id = await adapter.startSession({});
    await adapter.sendMessage(id, "ask me");
    await new Promise((r) => setTimeout(r, 10));

    expect(handlerCalled).toBe(false);
    expect(decision?.behavior).toBe("deny");
    expect(decision?.message).toMatch(/AskUserQuestion/);
  });

  it("history reads the transcript and maps user/brain/tool turns", async () => {
    const transcript: SessionMessage[] = [
      { type: "user", uuid: "1", session_id: "h1", parent_tool_use_id: null, message: { role: "user", content: "que horas são?" } },
      { type: "assistant", uuid: "2", session_id: "h1", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "text", text: "São 15h." }] } },
      { type: "assistant", uuid: "3", session_id: "h1", parent_tool_use_id: null, message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "/etc/hosts" } }] } },
      { type: "user", uuid: "4", session_id: "h1", parent_tool_use_id: null, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "127.0.0.1" }] } },
    ];
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("h1", [[{ kind: "text", text: "x" }]]),
      getMessagesFn: async () => transcript,
    });

    const id = await adapter.startSession({});
    await new Promise((r) => setTimeout(r, 10)); // let init register the Claude id
    const hist = await adapter.history(id);

    expect(hist).toEqual([
      { role: "user", text: "que horas são?" },
      { role: "brain", text: "São 15h." },
      { role: "tool", tool: "Read", input: { file_path: "/etc/hosts" }, id: "t1" },
    ])
  });

  it("history is empty for an unknown session", async () => {
    const adapter = new ClaudeCodeAdapter({ queryFn: fakeQuery("hx", []), getMessagesFn: async () => [] });
    expect(await adapter.history("nope")).toEqual([]);
  });

  it("passes model and effort into the SDK options", async () => {
    let captured: Options | undefined;
    const adapter = new ClaudeCodeAdapter({
      queryFn: (params) => {
        captured = params.options;
        const gen = (async function* (): AsyncGenerator<SDKMessage, void> {
          yield initMsg("m1");
          for await (const _u of params.prompt) yield resultMsg("m1", true, 0);
        })();
        return Object.assign(gen, { interrupt: async () => void (await gen.return()) });
      },
    });
    await adapter.startSession({ model: "claude-opus-4-8", effort: "high", systemPrompt: "rodando no debian, sem localhost" });
    expect(captured?.model).toBe("claude-opus-4-8");
    expect((captured as { effort?: string }).effort).toBe("high");
    expect(captured?.systemPrompt).toEqual({ type: "preset", preset: "claude_code", append: "rodando no debian, sem localhost" });
  });

  it("reconnects under the same public id, and spawns fresh when no Claude id is known", async () => {
    const adapter = new ClaudeCodeAdapter({
      queryFn: fakeQuery("claude-xyz", [
        [{ kind: "text", text: "primeiro" }, { kind: "result", ok: true }],
        [{ kind: "text", text: "retomado" }, { kind: "result", ok: true }],
      ]),
    });
    const texts: string[] = [];
    adapter.onEvent((_s, e) => {
      if (e.type === "text") texts.push(e.text);
    });

    const id = await adapter.startSession({});
    // First turn lets the adapter capture the Claude session id from init.
    await adapter.sendMessage(id, "a");
    await new Promise((r) => setTimeout(r, 10));
    await adapter.close(id);

    await adapter.resumeSession(id);
    await adapter.sendMessage(id, "b");
    await new Promise((r) => setTimeout(r, 10));

    expect(texts).toEqual(["primeiro", "retomado"]);

    // An id with no captured Claude id spawns a fresh brain instead of failing.
    await expect(adapter.resumeSession("never-seen")).resolves.toBeUndefined();
  });
});
