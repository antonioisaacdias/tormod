import { randomUUID } from "node:crypto";
import { getSessionMessages, query } from "@anthropic-ai/claude-agent-sdk";
import type {
  CanUseTool,
  EffortLevel,
  Options,
  SDKMessage,
  SDKUserMessage,
  SessionMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BrainAdapter,
  BrainEvent,
  HistoryItem,
  PermissionHandler,
} from "./adapter.js";

const ASK_INLINE_MESSAGE =
  "Esta interface de chat não tem seletor de perguntas (a ferramenta AskUserQuestion não funciona aqui). " +
  "Você DEVE agora fazer a(s) mesma(s) pergunta(s) diretamente na sua próxima resposta, em texto: enuncie " +
  "cada pergunta e liste suas opções de forma clara (lista numerada, uma opção por linha), e então pare e " +
  "aguarde a resposta do usuário pela conversa. Nunca omita a pergunta nem prossiga sem perguntar.";

/** The SDK `getSessionMessages`, narrowed (and faked in tests). */
export type GetMessagesFn = (
  sessionId: string,
  options?: { dir?: string },
) => Promise<SessionMessage[]>;

/** The slice of the SDK `Query` object this adapter drives. */
export type QueryLike = AsyncIterable<SDKMessage> & {
  interrupt(): Promise<void>;
  getContextUsage?(): Promise<{ totalTokens: number; maxTokens: number; model: string }>;
};

/** The SDK `query` function, narrowed to what the adapter needs (and faked in tests). */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options?: Options;
}) => QueryLike;

interface LiveSession {
  /** Tormod's stable, provider-neutral id (what the rest of the app keys on). */
  publicId: string;
  /** Claude Code's own session id, learned from the init message; used to resume. */
  claudeId: string | null;
  queue: PushQueue<SDKUserMessage>;
  q: QueryLike;
}

/**
 * Drives Claude Code through the Agent SDK and translates its messages into the
 * provider-neutral BrainEvent contract. Every tool use is routed through
 * `canUseTool` → the host permission handler — nothing uses the SDK's own
 * `allowedTools`, so the Tormod policy stays the single gate and audit point.
 *
 * Claude Code only emits its session id after the first user turn, so Tormod
 * owns the public id (a UUID minted at startSession) and maps it to the Claude
 * session id once the init message arrives — the Claude id never leaks past
 * this adapter except as the resume key.
 */
export class ClaudeCodeAdapter implements BrainAdapter {
  private readonly queryFn: QueryFn;
  private readonly getMessagesFn: GetMessagesFn;
  private readonly baseOptions: Options;
  private readonly streaming: boolean;
  private readonly sessions = new Map<string, LiveSession>();
  private readonly claudeIds = new Map<string, string>();
  private eventHandler: ((sessionId: string, event: BrainEvent) => void) | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private sessionIdHandler: ((sessionId: string, brainSessionId: string) => void) | null = null;

  constructor(
    opts: { queryFn?: QueryFn; getMessagesFn?: GetMessagesFn; options?: Options; streaming?: boolean } = {},
  ) {
    this.queryFn = opts.queryFn ?? (query as unknown as QueryFn);
    this.getMessagesFn = opts.getMessagesFn ?? (getSessionMessages as unknown as GetMessagesFn);
    this.baseOptions = opts.options ?? {};
    this.streaming = opts.streaming ?? false;
  }

  async history(id: string): Promise<HistoryItem[]> {
    const claudeId = this.claudeIds.get(id) ?? this.sessions.get(id)?.claudeId;
    if (!claudeId) return [];
    const dir = typeof this.baseOptions.cwd === "string" ? this.baseOptions.cwd : undefined;
    const messages = await this.getMessagesFn(claudeId, dir ? { dir } : {});
    return messages.flatMap(toHistory);
  }

  async startSession(opts: { cwd?: string; model?: string; effort?: string }): Promise<string> {
    const publicId = randomUUID();
    const session = this.spawn(publicId, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
    });
    this.sessions.set(publicId, session);
    void this.runConsumeLoop(session);
    return publicId;
  }

  async resumeSession(id: string): Promise<void> {
    // With a known Claude id, resume the transcript; without one (the session
    // never had a turn), spawn a fresh brain under the same id instead of failing.
    const claudeId = this.claudeIds.get(id);
    const session = this.spawn(id, claudeId ? { resume: claudeId } : {});
    session.claudeId = claudeId ?? null;
    this.sessions.set(id, session);
    void this.runConsumeLoop(session);
  }

  async sendMessage(id: string, text: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`unknown session: ${id}`);
    session.queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
    });
  }

  async interrupt(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    await session.q.interrupt().catch(() => {});
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    session.queue.close();
    await session.q.interrupt().catch(() => {});
    this.sessions.delete(id);
  }

  onEvent(handler: (sessionId: string, event: BrainEvent) => void): void {
    this.eventHandler = handler;
  }

  onPermissionRequest(handler: PermissionHandler): void {
    this.permissionHandler = handler;
  }

  onSessionId(handler: (sessionId: string, brainSessionId: string) => void): void {
    this.sessionIdHandler = handler;
  }

  registerSession(sessionId: string, brainSessionId: string): void {
    this.claudeIds.set(sessionId, brainSessionId);
  }

  private spawn(publicId: string, extra: { cwd?: string; resume?: string; model?: string; effort?: string }): LiveSession {
    const queue = new PushQueue<SDKUserMessage>();
    const session: LiveSession = {
      publicId,
      claudeId: extra.resume ?? null,
      queue,
      q: null as unknown as QueryLike,
    };

    const canUseTool: CanUseTool = async (toolName, input, o) => {
      // AskUserQuestion has no structured picker in this chat UI (it would render
      // as a nonsensical allow/deny card). Steer the brain to ask inline as text.
      if (toolName === "AskUserQuestion") {
        return { behavior: "deny", message: ASK_INLINE_MESSAGE };
      }
      const handler = this.permissionHandler;
      if (!handler) return { behavior: "deny", message: "permission handler unavailable" };
      const resp = await handler(publicId, { tool: toolName, input }, o.toolUseID);
      return resp.allow
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: resp.message ?? "denied" };
    };

    const options: Options = {
      ...this.baseOptions,
      permissionMode: "default",
      canUseTool,
      ...(this.streaming
        ? { includePartialMessages: true, thinking: { type: "adaptive", display: "summarized" } as const }
        : {}),
      ...(extra.cwd ? { cwd: extra.cwd } : {}),
      ...(extra.resume ? { resume: extra.resume } : {}),
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.effort ? { effort: extra.effort as EffortLevel } : {}),
    };
    session.q = this.queryFn({ prompt: queue, options });
    return session;
  }

  private async runConsumeLoop(session: LiveSession): Promise<void> {
    try {
      for await (const msg of session.q) {
        if (msg.type === "system" && msg.subtype === "init") {
          session.claudeId = msg.session_id;
          this.claudeIds.set(session.publicId, msg.session_id);
          this.sessionIdHandler?.(session.publicId, msg.session_id);
          if (typeof msg.model === "string") this.emit(session.publicId, { type: "usage", model: msg.model });
          continue;
        }
        if (msg.type === "rate_limit_event") {
          this.emitRateLimit(session.publicId, msg.rate_limit_info);
          continue;
        }
        if (msg.type === "stream_event") {
          this.translateStream(session.publicId, msg.event);
          continue;
        }
        this.translate(session.publicId, msg);
        if (msg.type === "result") void this.emitContextUsage(session);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit(session.publicId, { type: "error", message });
    }
  }

  private emitRateLimit(id: string, info: { rateLimitType?: string; utilization?: number }): void {
    if (typeof info.utilization !== "number" || !info.rateLimitType) return;
    const pct = Math.max(0, Math.min(100, Math.round(info.utilization * 100)));
    if (info.rateLimitType === "five_hour") {
      this.emit(id, { type: "usage", fiveHourPct: pct });
    } else if (info.rateLimitType.startsWith("seven_day")) {
      this.emit(id, { type: "usage", sevenDayPct: pct });
    }
  }

  private async emitContextUsage(session: LiveSession): Promise<void> {
    const get = session.q.getContextUsage;
    if (typeof get !== "function") return;
    try {
      const ctx = await get.call(session.q);
      this.emit(session.publicId, {
        type: "usage",
        model: ctx.model,
        contextTokens: ctx.totalTokens,
        contextWindow: ctx.maxTokens,
      });
    } catch {
      // context usage is best-effort; ignore failures
    }
  }

  private translate(id: string, msg: SDKMessage): void {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (typeof block === "string") continue;
        if (block.type === "text") {
          if (!this.streaming) this.emit(id, { type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          this.emit(id, {
            type: "tool_use",
            id: block.id,
            request: { tool: block.name, input: block.input as Record<string, unknown> },
          });
        }
      }
      return;
    }
    if (msg.type === "user") {
      const content = msg.message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block !== "string" && block.type === "tool_result") {
            this.emit(id, {
              type: "tool_result",
              id: block.tool_use_id,
              ok: block.is_error !== true,
              summary: summarize(block.content),
            });
          }
        }
      }
      return;
    }
    if (msg.type === "result") {
      this.emit(id, {
        type: "result",
        ok: msg.subtype === "success" && msg.is_error !== true,
        ...(typeof msg.total_cost_usd === "number" ? { costUsd: msg.total_cost_usd } : {}),
      });
    }
  }

  private translateStream(id: string, event: unknown): void {
    const e = event as { type?: string; delta?: { type?: string; text?: string; thinking?: string } };
    if (e.type !== "content_block_delta" || !e.delta) return;
    const { delta } = e;
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      this.emit(id, { type: "text", text: delta.text });
    } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      this.emit(id, { type: "thinking", text: delta.thinking });
    }
  }

  private emit(id: string, event: BrainEvent): void {
    this.eventHandler?.(id, event);
  }
}

/** Translates one stored transcript message into neutral history items. */
function toHistory(m: SessionMessage): HistoryItem[] {
  const message = m.message as { role?: string; content?: unknown } | null;
  const content = message?.content;

  if (m.type === "assistant" && Array.isArray(content)) {
    const out: HistoryItem[] = [];
    for (const raw of content) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as { type?: string; text?: unknown; name?: unknown; input?: unknown };
      if (block.type === "text" && typeof block.text === "string") {
        out.push({ role: "brain", text: block.text });
      } else if (block.type === "tool_use" && typeof block.name === "string") {
        out.push({
          role: "tool",
          tool: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
      }
    }
    return out;
  }

  if (m.type === "user") {
    if (typeof content === "string") return content.trim() ? [{ role: "user", text: content }] : [];
    if (Array.isArray(content)) {
      const out: HistoryItem[] = [];
      for (const raw of content) {
        if (raw && typeof raw === "object" && (raw as { type?: string }).type === "text") {
          const text = (raw as { text?: unknown }).text;
          if (typeof text === "string") out.push({ role: "user", text });
        }
      }
      return out;
    }
  }

  return [];
}

function summarize(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  return "";
}

/**
 * An async-iterable queue: producers `push()` messages over time, the consumer
 * (the SDK `prompt` stream) awaits them. This is what turns a one-shot `query()`
 * into a long-lived multi-turn session.
 */
class PushQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    let waiter: ((r: IteratorResult<T>) => void) | undefined;
    while ((waiter = this.waiters.shift())) waiter({ value: undefined as never, done: true });
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      const buffered = this.values.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
      if (next.done) return;
      yield next.value;
    }
  }
}
