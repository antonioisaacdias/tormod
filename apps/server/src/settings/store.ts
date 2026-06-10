import Database from "better-sqlite3";

export interface Settings {
  maxLiveSessions: number;
  idleCloseHours: number;
  defaultModel: "auto" | "opus" | "sonnet" | "haiku";
  defaultEffort: "auto" | "low" | "medium" | "high" | "xhigh" | "max";
}

export const DEFAULTS: Settings = {
  maxLiveSessions: 5,
  idleCloseHours: 6,
  defaultModel: "auto",
  defaultEffort: "auto",
};

const MODELS = new Set(["auto", "opus", "sonnet", "haiku"]);
const EFFORTS = new Set(["auto", "low", "medium", "high", "xhigh", "max"]);

function clamp(n: unknown, min: number, max: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

function normalize(raw: Partial<Settings>): Settings {
  return {
    maxLiveSessions: clamp(raw.maxLiveSessions, 1, 50, DEFAULTS.maxLiveSessions),
    idleCloseHours: clamp(raw.idleCloseHours, 0, 168, DEFAULTS.idleCloseHours),
    defaultModel: MODELS.has(raw.defaultModel as string)
      ? (raw.defaultModel as Settings["defaultModel"])
      : DEFAULTS.defaultModel,
    defaultEffort: EFFORTS.has(raw.defaultEffort as string)
      ? (raw.defaultEffort as Settings["defaultEffort"])
      : DEFAULTS.defaultEffort,
  };
}

export class SettingsStore {
  private constructor(private readonly db: Database.Database) {}

  static open(path: string): SettingsStore {
    const db = new Database(path);
    db.pragma("journal_mode = WAL");
    db.exec(
      `CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);`,
    );
    return new SettingsStore(db);
  }

  get(): Settings {
    const row = this.db
      .prepare(`SELECT data FROM settings WHERE id = 1`)
      .get() as { data: string } | undefined;
    if (!row) return DEFAULTS;
    try {
      return normalize({ ...DEFAULTS, ...(JSON.parse(row.data) as Partial<Settings>) });
    } catch {
      return DEFAULTS;
    }
  }

  save(patch: Partial<Settings>): Settings {
    const next = normalize({ ...this.get(), ...patch });
    this.db
      .prepare(
        `INSERT INTO settings (id, data) VALUES (1, @data) ON CONFLICT(id) DO UPDATE SET data = @data`,
      )
      .run({ data: JSON.stringify(next) });
    return next;
  }
}
