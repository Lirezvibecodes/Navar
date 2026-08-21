import { Pool } from "pg";
import { config } from "./config";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;

  if (!config.databaseUrl) {
    throw new Error("Missing required env var: DATABASE_URL");
  }

  pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: config.databaseUrl.includes("localhost")
      ? undefined
      : { rejectUnauthorized: false },
  });

  return pool;
}
