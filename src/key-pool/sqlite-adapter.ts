import type { StorageAdapter, ApiKey } from "./types.js";

/**
 * SQLite reference implementation of StorageAdapter.
 * Uses better-sqlite3 (synchronous API) wrapped in async for interface compatibility.
 *
 * Schema (compatible with mind-diary's api_keys table):
 *
 *   CREATE TABLE IF NOT EXISTS api_keys (
 *     id           INTEGER PRIMARY KEY,
 *     key          TEXT    NOT NULL UNIQUE,
 *     is_active    INTEGER NOT NULL DEFAULT 1,
 *     cooldown_until INTEGER NOT NULL DEFAULT 0,
 *     usage_count  INTEGER NOT NULL DEFAULT 0
 *   );
 *
 * Run SqliteAdapter.createTable(db) to initialize the schema.
 */
export class SqliteAdapter implements StorageAdapter {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /** Create the api_keys table if it doesn't exist */
  static createTable(db: SqliteDatabase): void {
    db.prepare(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        key           TEXT    NOT NULL UNIQUE,
        is_active     INTEGER NOT NULL DEFAULT 1,
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        usage_count   INTEGER NOT NULL DEFAULT 0
      )
    `).run();
  }

  async getKeys(): Promise<ApiKey[]> {
    const rows = this.db
      .prepare(
        "SELECT id, key, is_active, cooldown_until, usage_count FROM api_keys"
      )
      .all() as SqliteRow[];

    return rows.map(rowToApiKey);
  }

  async updateKey(key: ApiKey): Promise<void> {
    this.db
      .prepare(
        `UPDATE api_keys
         SET is_active = ?, cooldown_until = ?, usage_count = ?
         WHERE id = ?`
      )
      .run(
        key.isActive ? 1 : 0,
        key.cooldownUntil,
        key.usageCount,
        key.id
      );
  }

  /** Insert a new key (convenience helper). */
  insertKey(key: string): void {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO api_keys (key) VALUES (?)"
      )
      .run(key);
  }
}

// ── Internal types ─────────────────────────────────────────────────────

interface SqliteRow {
  id: number;
  key: string;
  is_active: number;
  cooldown_until: number;
  usage_count: number;
}

// Minimal interface for better-sqlite3 Database
export interface SqliteDatabase {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    all(...args: unknown[]): unknown[];
    get(...args: unknown[]): unknown;
  };
}

function rowToApiKey(row: SqliteRow): ApiKey {
  return {
    id: row.id,
    key: row.key,
    isActive: row.is_active === 1,
    cooldownUntil: row.cooldown_until,
    usageCount: row.usage_count,
  };
}
