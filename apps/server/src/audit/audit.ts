import Database from "better-sqlite3";

export interface AuditInput {
  sessionId?: string;
  node?: string;
  tool: string;
  command?: string;
  tier: string;
  approved: 0 | 1 | 2; // 0 auto/read · 1 approved · 2 denied
  exitCode?: number;
  durationMs?: number;
}

export interface AuditRow extends AuditInput {
  id: number;
  ts: string;
}

export interface AuditFilter {
  node?: string;
  tier?: string;
  sessionId?: string;
}

export class Audit {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): Audit {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        session_id TEXT,
        node TEXT,
        tool TEXT NOT NULL,
        command TEXT,
        tier TEXT NOT NULL,
        approved INTEGER NOT NULL,
        exit_code INTEGER,
        duration_ms INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
      CREATE INDEX IF NOT EXISTS idx_audit_node_tier ON audit(node, tier);
    `);
    return new Audit(db);
  }

  record(input: AuditInput): void {
    this.db
      .prepare(
        `INSERT INTO audit (ts, session_id, node, tool, command, tier, approved, exit_code, duration_ms)
         VALUES (@ts, @sessionId, @node, @tool, @command, @tier, @approved, @exitCode, @durationMs)`,
      )
      .run({
        ts: new Date().toISOString(),
        sessionId: input.sessionId ?? null,
        node: input.node ?? null,
        tool: input.tool,
        command: input.command ?? null,
        tier: input.tier,
        approved: input.approved,
        exitCode: input.exitCode ?? null,
        durationMs: input.durationMs ?? null,
      });
  }

  query(filter: AuditFilter): AuditRow[] {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (filter.node) { where.push("node = @node"); params.node = filter.node; }
    if (filter.tier) { where.push("tier = @tier"); params.tier = filter.tier; }
    if (filter.sessionId) { where.push("session_id = @sessionId"); params.sessionId = filter.sessionId; }
    const sql = `SELECT id, ts, session_id as sessionId, node, tool, command, tier, approved, exit_code as exitCode, duration_ms as durationMs
                 FROM audit ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY id`;
    return this.db.prepare(sql).all(params) as AuditRow[];
  }
}
