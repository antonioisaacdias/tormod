import type { PermissionDecision, ToolRequest } from "../types.js";

/** Events streamed from the brain to the host (provider-neutral). */
export type BrainEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; request: ToolRequest }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "result"; ok: boolean; costUsd?: number }
  | { type: "error"; message: string };

/** Decision returned to the brain for a pending tool use. */
export interface PermissionResponse {
  allow: boolean;
  /** Optional message shown to the brain when denied. */
  message?: string;
}

/**
 * Callback the host registers to decide on a tool use. Async: it may await a
 * human pressing a button in the browser. Mirrors the Agent SDK `canUseTool`.
 */
export type PermissionHandler = (
  sessionId: string,
  request: ToolRequest,
  toolUseId: string,
) => Promise<PermissionResponse>;

/**
 * The seam between Tormod and any "brain" (Claude Code today; Codex/local
 * later). Implementations live behind this interface so nothing above it is
 * provider-specific.
 */
export interface BrainAdapter {
  /** Start a fresh session; resolves with the session id. */
  startSession(opts: { cwd?: string }): Promise<string>;
  /** Resume an existing session by id. */
  resumeSession(id: string): Promise<void>;
  /** Send a user message into a live session. */
  sendMessage(id: string, text: string): Promise<void>;
  /** Tear down the live process for a session (transcript persists). */
  close(id: string): Promise<void>;
  /** Register the stream handler for brain events. */
  onEvent(handler: (sessionId: string, event: BrainEvent) => void): void;
  /** Register the permission handler (the approval-card bridge). */
  onPermissionRequest(handler: PermissionHandler): void;
}

export type { PermissionDecision, ToolRequest };
