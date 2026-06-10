import type {
  BrainAdapter,
  BrainEvent,
  PermissionHandler,
} from "./adapter.js";

/**
 * A scriptable BrainAdapter for tests. No LLM. `script()` queues the events a
 * subsequent sendMessage() will replay. tool_use events are routed through the
 * permission handler; the result (allow/deny) becomes a tool_result.
 */
export class FakeBrainAdapter implements BrainAdapter {
  private eventHandler: ((sessionId: string, event: BrainEvent) => void) | null = null;
  private permissionHandler: PermissionHandler | null = null;
  private sessionIdHandler: ((sessionId: string, brainSessionId: string) => void) | null = null;
  private queued: BrainEvent[] = [];
  private counter = 0;
  private readonly live = new Set<string>();

  async startSession(_opts: { cwd?: string; model?: string; effort?: string }): Promise<string> {
    const id = `fake-${++this.counter}`;
    this.live.add(id);
    this.sessionIdHandler?.(id, id);
    return id;
  }

  async resumeSession(id: string): Promise<void> {
    this.live.add(id);
  }

  async interrupt(_id: string): Promise<void> {
    // No live process to interrupt in the fake.
  }

  async close(id: string): Promise<void> {
    this.live.delete(id);
  }

  async history(_id: string): Promise<[]> {
    return [];
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

  registerSession(_sessionId: string, _brainSessionId: string): void {
    // No durable transcript to map to; nothing to seed.
  }

  /** Queue the events the next sendMessage() will replay. */
  script(events: BrainEvent[]): void {
    this.queued = [...events];
  }

  async sendMessage(id: string, _text: string): Promise<void> {
    const events = this.queued;
    this.queued = [];
    for (const event of events) {
      if (event.type === "tool_use") {
        const resp = this.permissionHandler
          ? await this.permissionHandler(id, event.request, event.id)
          : { allow: false, message: "no handler" };
        this.emit(id, event);
        this.emit(id, {
          type: "tool_result",
          id: event.id,
          ok: resp.allow,
          summary: resp.allow ? "executed" : (resp.message ?? "denied"),
        });
      } else {
        this.emit(id, event);
      }
    }
  }

  private emit(id: string, event: BrainEvent): void {
    this.eventHandler?.(id, event);
  }
}
