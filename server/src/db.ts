import { Pool, PoolClient } from "pg";
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

/**
 * Run a unit of work on one connection inside a transaction, rolling back on
 * any throw and always returning the connection to the pool.
 *
 * Needed wherever a decision is read and then written on the basis of what was
 * read — a friend request that has to know whether the reverse request already
 * exists, or an ingest that reads its session inside the same transaction that
 * inserts the track. Doing those as two pool queries lets a second concurrent
 * message interleave between them.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
