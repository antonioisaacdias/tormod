import Database from "better-sqlite3";

/** Last-known usage of a session, persisted so the infoline shows it on open. */
export interface UsageSnapshot {
  model?: string;
  contextTokens?: number;
  contextWindow?: number;
  fiveHourPct?: number;
  sevenDayPct?: number;
}

export interface StoredSession {
  id: string;
  title: string;
  cwd?: string;
  claudeId?: string;
  status: "live" | "closed";
  createdAt: string;
  lastActivityAt: string;
  usage?: UsageSnapshot;
  permissionMode?: "default" | "auto";
}

interface Row {
  id: string;
  title: string;
  cwd: string | null;
  claude_id: string | null;
  status: string;
  created_at: string;
  last_activity_at: string | null;
  usage: string | null;
  permission_mode: string | null;
}

/**
 * Durable session list (SQLite). Survives daemon restarts so the session list
 * and the publicId↔claudeId mapping (for history/resume) are not lost when the
 * in-memory SessionManager is rebuilt. Lives in the same DB file as the audit.
 */
export class SessionStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): SessionStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        cwd TEXT,
        claude_id TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_activity_at TEXT,
        usage TEXT,
        permission_mode TEXT
      );
    `);
    const cols = db.prepare(`PRAGMA table_info(sessions)`).all() as { name: string }[];
    if (!cols.some((c) => c.name === "usage")) db.exec(`ALTER TABLE sessions ADD COLUMN usage TEXT`);
    if (!cols.some((c) => c.name === "permission_mode")) db.exec(`ALTER TABLE sessions ADD COLUMN permission_mode TEXT`);
    return new SessionStore(db);
  }

  upsert(s: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, cwd, status, created_at, last_activity_at, permission_mode)
         VALUES (@id, @title, @cwd, @status, @createdAt, @lastActivityAt, @permissionMode)
         ON CONFLICT(id) DO UPDATE SET title = @title, cwd = @cwd, status = @status, last_activity_at = @lastActivityAt, permission_mode = @permissionMode`,
      )
      .run({
        id: s.id,
        title: s.title,
        cwd: s.cwd ?? null,
        status: s.status,
        createdAt: s.createdAt,
        lastActivityAt: s.lastActivityAt,
        permissionMode: s.permissionMode ?? null,
      });
  }

  setPermissionMode(id: string, mode: "default" | "auto"): void {
    this.db.prepare(`UPDATE sessions SET permission_mode = ? WHERE id = ?`).run(mode, id);
  }

  setActivity(id: string, lastActivityAt: string): void {
    this.db.prepare(`UPDATE sessions SET last_activity_at = ? WHERE id = ?`).run(lastActivityAt, id);
  }

  setClaudeId(id: string, claudeId: string): void {
    this.db.prepare(`UPDATE sessions SET claude_id = ? WHERE id = ?`).run(claudeId, id);
  }

  setUsage(id: string, usage: UsageSnapshot): void {
    this.db.prepare(`UPDATE sessions SET usage = ? WHERE id = ?`).run(JSON.stringify(usage), id);
  }

  setStatus(id: string, status: "live" | "closed"): void {
    this.db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(status, id);
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  all(): StoredSession[] {
    const rows = this.db
      .prepare(`SELECT id, title, cwd, claude_id, status, created_at, last_activity_at, usage, permission_mode FROM sessions ORDER BY created_at`)
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      ...(r.cwd !== null ? { cwd: r.cwd } : {}),
      ...(r.claude_id !== null ? { claudeId: r.claude_id } : {}),
      status: r.status === "closed" ? "closed" : "live",
      createdAt: r.created_at,
      lastActivityAt: r.last_activity_at ?? r.created_at,
      ...(r.usage !== null ? { usage: parseUsage(r.usage) } : {}),
      ...(r.permission_mode === "auto" || r.permission_mode === "default" ? { permissionMode: r.permission_mode } : {}),
    }));
  }
}

function parseUsage(raw: string): UsageSnapshot {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as UsageSnapshot) : {};
  } catch {
    return {};
  }
}
