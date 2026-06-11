import Database from "better-sqlite3";

export interface NewUser {
  username: string;
  email: string;
  passwordHash: string;
}

export interface Credentials {
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  totpEnabled: boolean;
}

export interface Profile {
  username: string;
  email: string;
  totpEnabled: boolean;
}

interface Row {
  username: string;
  email: string;
  pw_hash: string;
  totp_secret: string | null;
  totp_enabled: number;
}

export class UserStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): UserStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        username TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        pw_hash TEXT NOT NULL,
        totp_secret TEXT,
        totp_enabled INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
    `);
    return new UserStore(db);
  }

  hasUser(): boolean {
    const row = this.db.prepare(`SELECT 1 FROM users WHERE id = 1`).get();
    return !!row;
  }

  create(user: NewUser): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, email, pw_hash, totp_enabled, created_at)
         VALUES (1, @username, @email, @passwordHash, 0, @createdAt)`,
      )
      .run({ ...user, createdAt: Date.now() });
  }

  private row(): Row | undefined {
    return this.db
      .prepare(`SELECT username, email, pw_hash, totp_secret, totp_enabled FROM users WHERE id = 1`)
      .get() as Row | undefined;
  }

  getCredentials(): Credentials | null {
    const r = this.row();
    if (!r) return null;
    return {
      username: r.username,
      passwordHash: r.pw_hash,
      totpSecret: r.totp_secret,
      totpEnabled: r.totp_enabled === 1,
    };
  }

  profile(): Profile | null {
    const r = this.row();
    if (!r) return null;
    return { username: r.username, email: r.email, totpEnabled: r.totp_enabled === 1 };
  }

  setTotpSecret(secret: string): void {
    this.db.prepare(`UPDATE users SET totp_secret = ?, totp_enabled = 0 WHERE id = 1`).run(secret);
  }

  enableTotp(): void {
    this.db.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = 1`).run();
  }

  disableTotp(): void {
    this.db.prepare(`UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = 1`).run();
  }
}
