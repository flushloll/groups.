// Copy local Groups data (.groups-data/groups.sqlite) into the Postgres
// database named by DATABASE_URL. Start the server against Postgres once
// first so its tables exist. Local spaces replace same-named hosted ones;
// other existing rows are left untouched.
//
//   DATABASE_URL=postgres://... node scripts/copy-to-postgres.mjs [path/to/groups.sqlite]
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import pg from "pg";

const source = resolve(process.argv[2] || ".groups-data/groups.sqlite");
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL to the target Postgres database.");
  process.exit(1);
}
const local = new DatabaseSync(source, { readOnly: true });
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL) ? false : { rejectUnauthorized: false },
});
// Better Auth's tables first, then Groups' tables in foreign-key order.
const tables = ["user", "session", "account", "verification", "spaces", "memberships", "invitations", "checkpoints"];
for (const table of tables) {
  const exists = local.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
  if (!exists) continue;
  const columns = (
    await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1",
      [table],
    )
  ).rows;
  if (!columns.length) {
    console.error(`Postgres has no "${table}" table yet. Start the server with DATABASE_URL once, then rerun.`);
    process.exit(1);
  }
  const types = new Map(columns.map((column) => [column.column_name, column.data_type]));
  const rows = local.prepare(`SELECT * FROM "${table}"`).all();
  let copied = 0;
  for (const row of rows) {
    const names = Object.keys(row).filter((name) => types.has(name));
    const values = names.map((name) => {
      const value = row[name];
      const type = types.get(name);
      if (value === null) return null;
      if (type === "boolean") return Boolean(value);
      if (type.startsWith("timestamp") && typeof value === "number") return new Date(value);
      return value;
    });
    const result = await pool.query(
      `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names
        .map((_, index) => `$${index + 1}`)
        .join(", ")}) ${
        // Local spaces replace the fresh built-ins the hosted server created on first start.
        table === "spaces"
          ? `ON CONFLICT (id) DO UPDATE SET ${names
              .filter((name) => name !== "id")
              .map((name) => `"${name}" = excluded."${name}"`)
              .join(", ")}`
          : "ON CONFLICT DO NOTHING"
      }`,
      values,
    );
    copied += result.rowCount;
  }
  console.log(`${table}: copied ${copied} of ${rows.length}`);
}
await pool.end();
console.log("Done. Restart the hosted server so it reloads its caches.");
