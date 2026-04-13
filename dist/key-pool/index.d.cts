import { S as StorageAdapter, A as ApiKey } from '../key-pool-B_aQJxIM.cjs';
export { K as KeyPool, a as KeyPoolOptions, N as NoAvailableKeyError } from '../key-pool-B_aQJxIM.cjs';

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
declare class SqliteAdapter implements StorageAdapter {
    private readonly db;
    private leaseColumnsReady;
    constructor(db: SqliteDatabase);
    /** Create the api_keys table if it doesn't exist */
    static createTable(db: SqliteDatabase): void;
    private ensureLeaseColumns;
    getKeys(): Promise<ApiKey[]>;
    acquireLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean>;
    renewLease(keyId: number, leaseUntil: number, leaseToken: string, now: number): Promise<boolean>;
    updateKey(key: ApiKey, expectedLeaseToken?: string | null): Promise<void>;
    /** Insert a new key (convenience helper). */
    insertKey(key: string): void;
}
interface SqliteDatabase {
    prepare(sql: string): {
        run(...args: unknown[]): unknown;
        all(...args: unknown[]): unknown[];
        get(...args: unknown[]): unknown;
    };
}

export { ApiKey, SqliteAdapter, type SqliteDatabase, StorageAdapter };
