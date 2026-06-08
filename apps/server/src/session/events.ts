import type { BrainEvent, ToolRequest } from "../brain/adapter.js";
import type { Tier } from "../types.js";

/** Events sent to SSE subscribers — brain events plus permission lifecycle. */
export type ServerEvent =
  | BrainEvent
  | { type: "permission_request"; toolUseId: string; request: ToolRequest; tier: Tier; literal?: string }
  | { type: "permission_resolved"; toolUseId: string; allow: boolean };
