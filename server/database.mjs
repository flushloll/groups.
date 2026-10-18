// One small async SQL interface over SQLite (local) and Postgres (hosted).
// Queries use `?` placeholders; the Postgres adapter numbers them.
import { DatabaseSync } from "node:sqlite";
import { chmod } from "node:fs/promises";
import { resolve } from "node:path";

const SCHEMA = (bigint) => `
  CREATE TABLE IF NOT EXISTS spaces (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL,
    visibility TEXT NOT NULL, join_role TEXT NOT NULL,
    color TEXT NOT NULL, theme TEXT NOT NULL, owner_id TEXT,
    workspace TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS memberships (
    space_id TEXT NOT NULL REFERENCES spaces(id), user_id TEXT NOT NULL,
    role TEXT NOT NULL, PRIMARY KEY(space_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS invitations (
    token_hash TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id),
    role TEXT NOT NULL, expires_at ${bigint} NOT NULL
  );
  CREATE TABLE IF NOT EXISTS checkpoints (
    id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), room_id TEXT NOT NULL,
    title TEXT NOT NULL, created_at TEXT NOT NULL, actor TEXT NOT NULL,
    object_count INTEGER NOT NULL, snapshot TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS checkpoint_room ON checkpoints(space_id, room_id, created_at);
  CREATE TABLE IF NOT EXISTS groups_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

function sqlite(directory) {
  const path = resolve(directory, "groups.sqlite");
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA("INTEGER"));
  const client = {
    async query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
  };
  // node:sqlite is synchronous, so a transaction cannot interleave with other queries.
  let queue = Promise.resolve();
  return {
    kind: "sqlite",
    path,
    authDatabase: db,
    currentRoom: "json_extract(workspace, '$.currentId')",
    ...client,
    transaction(operation) {
      const result = queue.then(async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const value = await operation(client);
          db.exec("COMMIT");
          return value;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      db.close();
    },
  };
}

async function postgres(url) {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({
    connectionString: url,
    max: 8,
    idleTimeoutMillis: 30000,
    // Managed providers (Neon, Render) require TLS; local servers usually don't.
    ssl: /sslmode=disable/.test(url) || /@(localhost|127\.0\.0\.1)[:/]/.test(url)
      ? false
      : { rejectUnauthorized: false },
  });
  const numbered = (sql) => {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  };
  const wrap = (target) => ({
    async query(sql, params = []) {
      return (await target.query(numbered(sql), params)).rows;
    },
    async run(sql, params = []) {
      await target.query(numbered(sql), params);
    },
  });
  await pool.query(SCHEMA("BIGINT"));
  return {
    kind: "postgres",
    authDatabase: pool,
    currentRoom: "(workspace::jsonb)->>'currentId'",
    ...wrap(pool),
    async transaction(operation) {
      const connection = await pool.connect();
      try {
        await connection.query("BEGIN");
        const value = await operation(wrap(connection));
        await connection.query("COMMIT");
        return value;
      } catch (error) {
        await connection.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        connection.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

/** Postgres when DATABASE_URL is set; otherwise SQLite in the data directory. */
export async function openDatabase(directory) {
  if (process.env.DATABASE_URL) return postgres(process.env.DATABASE_URL);
  const database = sqlite(directory);
  await chmod(database.path, 0o600);
  return database;
}
