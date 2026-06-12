import type { UserStore } from "./users.js";
import type { AuthSessionStore } from "./authSessions.js";
import type { Throttle } from "./throttle.js";

export interface AuthConfig {
  trustedProxy: string | null;
  trustedCidrs: string[];
  cookieSecure: boolean;
  sessionTtlDays: number;
}

export interface AuthContext {
  users: UserStore;
  sessions: AuthSessionStore;
  throttle: Throttle;
  config: AuthConfig;
}

const DEFAULT_CIDRS = ["192.168.0.0/24", "10.0.0.0/24", "127.0.0.1/32", "::1/128"];

export function authConfigFromEnv(env: Record<string, string | undefined>): AuthConfig {
  const cidrs = env.TORMOD_TRUSTED_CIDRS
    ? env.TORMOD_TRUSTED_CIDRS.split(",").map((s) => s.trim()).filter(Boolean)
    : DEFAULT_CIDRS;
  const ttl = Number(env.TORMOD_SESSION_TTL_DAYS);
  return {
    trustedProxy: env.TORMOD_TRUSTED_PROXY?.trim() || null,
    trustedCidrs: cidrs,
    cookieSecure: env.TORMOD_COOKIE_SECURE !== "false",
    sessionTtlDays: Number.isFinite(ttl) && ttl > 0 ? ttl : 30,
  };
}
