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
 *     lease_until  INTEGER NOT NULL DEFAULT 0,
 *     lease_token  TEXT,
 *     usage_count  INTEGER NOT NULL DEFAULT 0
 *   );
 *
 * Run SqliteAdapter.createTable(db) to initialize the schema.
 */
export class SqliteAdapter implements StorageAdapter {
  private readonly db: SqliteDatabase;
  private leaseColumnsReady: boolean | null = null;

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
        lease_until   INTEGER NOT NULL DEFAULT 0,
        lease_token   TEXT,
        usage_count   INTEGER NOT NULL DEFAULT 0
      )
    `).run();

    try {
      db.prepare(
        "ALTER TABLE api_keys ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0"
      ).run();
    } catch {
      // Column already exists or ALTER TABLE unsupported; ignore.
    }
    try {
      db.prepare("ALTER TABLE api_keys ADD COLUMN lease_token TEXT").run();
    } catch {
      // Column already exists or ALTER TABLE unsupported; ignore.
    }
  }

  private ensureLeaseColumns(): boolean {
    if (this.leaseColumnsReady === true) return true;

    try {
      const columns = this.db
        .prepare("PRAGMA table_info(api_keys)")
        .all() as Array<{ name: string }>;
      const hasLeaseUntil = columns.some((column) => column.name === "lease_until");
      const hasLeaseToken = columns.some((column) => column.name === "lease_token");
      if (!hasLeaseUntil) {
        this.db.prepare(
          "ALTER TABLE api_keys ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0"
        ).run();
      }
      if (!hasLeaseToken) {
        this.db.prepare("ALTER TABLE api_keys ADD COLUMN lease_token TEXT").run();
      }
      this.leaseColumnsReady = true;
      return true;
    } catch (error) {
      this.leaseColumnsReady = null;
      throw new Error(
        `ai-core key pool requires lease_until and lease_token columns: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async getKeys(): Promise<ApiKey[]> {
    this.ensureLeaseColumns();
    const rows = this.db
      .prepare(
        "SELECT id, key, is_active, cooldown_until, lease_until, lease_token, usage_count FROM api_keys"
      )
      .all() as SqliteRow[];

    return rows.map(rowToApiKey);
  }

  async acquireLease(
    keyId: number,
    leaseUntil: number,
    leaseToken: string,
    now: number
  ): Promise<boolean> {
    this.ensureLeaseColumns();
    const result = this.db
      .prepare(
        `UPDATE api_keys
         SET lease_until = ?, lease_token = ?
         WHERE id = ? AND is_active = 1 AND cooldown_until <= ? AND lease_until <= ?`
      )
      .run(leaseUntil, leaseToken, keyId, now, now) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  async renewLease(
    keyId: number,
    leaseUntil: number,
    leaseToken: string,
    now: number
  ): Promise<boolean> {
    this.ensureLeaseColumns();
    const result = this.db
      .prepare(
        `UPDATE api_keys
         SET lease_until = ?
         WHERE id = ? AND lease_token = ? AND lease_until > ?`
      )
      .run(leaseUntil, keyId, leaseToken, now) as { changes?: number };
    return (result.changes ?? 0) > 0;
  }

  async updateKey(
    key: ApiKey,
    expectedLeaseToken?: string | null
  ): Promise<void> {
    this.ensureLeaseColumns();

    if (expectedLeaseToken === undefined) {
      this.db
        .prepare(
          `UPDATE api_keys
           SET is_active = ?, cooldown_until = ?, lease_until = ?, lease_token = ?, usage_count = ?
           WHERE id = ?`
        )
        .run(
          key.isActive ? 1 : 0,
          key.cooldownUntil,
          key.leaseUntil,
          key.leaseToken,
          key.usageCount,
          key.id
        );
      return;
    }

    this.db
      .prepare(
        `UPDATE api_keys
         SET is_active = ?, cooldown_until = ?, lease_until = ?, lease_token = ?, usage_count = ?
         WHERE id = ? AND ((? IS NULL AND lease_token IS NULL) OR lease_token = ?)`
      )
      .run(
        key.isActive ? 1 : 0,
        key.cooldownUntil,
        key.leaseUntil,
        key.leaseToken,
        key.usageCount,
        key.id,
        expectedLeaseToken,
        expectedLeaseToken
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
  lease_until?: number;
  lease_token?: string | null;
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
    leaseUntil: row.lease_until ?? 0,
    leaseToken: row.lease_token ?? null,
    usageCount: row.usage_count,
  };
}
