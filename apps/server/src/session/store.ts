import Database from "better-sqlite3";

export interface StoredSession {
  id: string;
  title: string;
  cwd?: string;
  claudeId?: string;
  status: "live" | "closed";
  createdAt: string;
}

interface Row {
  id: string;
  title: string;
  cwd: string | null;
  claude_id: string | null;
  status: string;
  created_at: string;
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
        created_at TEXT NOT NULL
      );
    `);
    return new SessionStore(db);
  }

  upsert(s: StoredSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, title, cwd, status, created_at)
         VALUES (@id, @title, @cwd, @status, @createdAt)
         ON CONFLICT(id) DO UPDATE SET title = @title, cwd = @cwd, status = @status`,
      )
      .run({
        id: s.id,
        title: s.title,
        cwd: s.cwd ?? null,
        status: s.status,
        createdAt: s.createdAt,
      });
  }

  setClaudeId(id: string, claudeId: string): void {
    this.db.prepare(`UPDATE sessions SET claude_id = ? WHERE id = ?`).run(claudeId, id);
  }

  setStatus(id: string, status: "live" | "closed"): void {
    this.db.prepare(`UPDATE sessions SET status = ? WHERE id = ?`).run(status, id);
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
  }

  all(): StoredSession[] {
    const rows = this.db
      .prepare(`SELECT id, title, cwd, claude_id, status, created_at FROM sessions ORDER BY created_at`)
      .all() as Row[];
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      ...(r.cwd !== null ? { cwd: r.cwd } : {}),
      ...(r.claude_id !== null ? { claudeId: r.claude_id } : {}),
      status: r.status === "closed" ? "closed" : "live",
      createdAt: r.created_at,
    }));
  }
}
