import Database from "better-sqlite3";
import { randomBytes, createHash } from "node:crypto";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export class AuthSessionStore {
  private constructor(
    private readonly db: Database.Database,
    private readonly ttlMs: number,
  ) {}

  static open(path: string, ttlDays: number): AuthSessionStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS auth_sessions (
        id_hash TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL
      );
    `);
    return new AuthSessionStore(db, ttlDays * 24 * 60 * 60 * 1000);
  }

  issue(now: number = Date.now()): { id: string; expiresAt: number } {
    const id = randomBytes(32).toString("base64url");
    const expiresAt = now + this.ttlMs;
    this.db
      .prepare(`INSERT INTO auth_sessions (id_hash, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)`)
      .run(sha256(id), now, expiresAt, now);
    return { id, expiresAt };
  }

  validate(id: string, now: number = Date.now()): boolean {
    const row = this.db
      .prepare(`SELECT expires_at FROM auth_sessions WHERE id_hash = ?`)
      .get(sha256(id)) as { expires_at: number } | undefined;
    if (!row || now >= row.expires_at) return false;
    this.db.prepare(`UPDATE auth_sessions SET last_seen = ? WHERE id_hash = ?`).run(now, sha256(id));
    return true;
  }

  revoke(id: string): void {
    this.db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?`).run(sha256(id));
  }

  revokeAll(): void {
    this.db.prepare(`DELETE FROM auth_sessions`).run();
  }

  debugStoredKeys(): string[] {
    return (this.db.prepare(`SELECT id_hash FROM auth_sessions`).all() as { id_hash: string }[]).map(
      (r) => r.id_hash,
    );
  }
}
