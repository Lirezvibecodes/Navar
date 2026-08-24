import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { getPool } from "./db";

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

/**
 * Applies every unapplied .up.sql, newest last, one transaction each. Exported
 * so the test suite can bring a scratch database up to the current schema
 * without shelling out.
 */
export async function runMigrations(): Promise<void> {
  const pool = getPool();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".up.sql"))
    .sort();

  const { rows } = await pool.query<{ name: string }>(
    "SELECT name FROM schema_migrations"
  );
  const applied = new Set(rows.map((r) => r.name));

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`[migrate] skipping ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => getPool().end())
    .catch((err) => {
      console.error("[migrate] failed:", err);
      process.exit(1);
    });
}

