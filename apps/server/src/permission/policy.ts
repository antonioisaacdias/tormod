import { split } from "shlex";
import type { PermissionDecision, ToolRequest } from "../types.js";
import { DEFAULT_POLICY, type PolicyConfig } from "./defaults.js";

const deny = (reason: string): PermissionDecision => ({ tier: "deny", reason });
const auto = (reason: string): PermissionDecision => ({ tier: "auto", reason });
const approve = (reason: string, literal?: string): PermissionDecision => ({
  tier: "approve",
  reason,
  ...(literal === undefined ? {} : { literal }),
});

/**
 * Classify a tool-use request into a permission tier.
 * Pure function — no I/O. This is the security gate: nothing that mutates
 * state is auto, and nothing auto can exfiltrate or mutate.
 */
export function classifyTool(
  req: ToolRequest,
  config: PolicyConfig = DEFAULT_POLICY,
): PermissionDecision {
  if (config.outboundTools.has(req.tool)) {
    return approve("outbound tool — never auto (exfiltration risk)");
  }
  if (config.readOnlyTools.has(req.tool)) {
    return auto("read-only tool");
  }
  if (req.tool === "Bash") {
    return classifyBash(String(req.input.command ?? ""), config);
  }
  return approve("mutating or unknown tool — requires approval");
}

function classifyBash(command: string, config: PolicyConfig): PermissionDecision {
  const trimmed = command.trim();
  if (trimmed === "") return approve("empty command", command);

  const lower = trimmed.toLowerCase();
  for (const sub of config.destructiveSubstrings) {
    if (lower.includes(sub)) return deny(`destructive pattern: ${sub}`);
  }

  let tokens: string[];
  try {
    tokens = split(trimmed);
  } catch {
    return approve("unparseable command — cannot prove safe", command);
  }
  if (tokens.length === 0) return approve("empty command", command);

  const bin = tokens[0] ?? "";
  if (config.destructiveBins.has(bin)) return deny(`destructive binary: ${bin}`);

  const CHAINERS = new Set(["&&", "||", ";", "|", "&", ">", ">>", "<"]);
  const hasChain = tokens.some((t) => CHAINERS.has(t)) || /[;|&><]/.test(trimmed);

  if (!hasChain && isSingleSafe(tokens, config)) return auto(`safe command: ${bin}`);

  return approve("command not on safe allowlist — requires approval", command);
}

/** True if argv[0] (or "argv0 argv1") is on the safe allowlist. */
function isSingleSafe(tokens: string[], config: PolicyConfig): boolean {
  const one = tokens[0] ?? "";
  const two = tokens.length >= 2 ? `${tokens[0]} ${tokens[1]}` : "";
  return config.safeBash.has(two) || config.safeBash.has(one);
}
