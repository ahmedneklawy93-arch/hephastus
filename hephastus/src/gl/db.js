// The general ledger's database: Postgres in production (DATABASE_URL), or an
// in-process Postgres (PGlite) for tests. Both expose the same small interface:
//   query(sql, params) -> rows
//   tx(fn)             -> runs fn(query) in one transaction; any throw rolls back.

import { SCHEMA_SQL } from "./schema.js";

export async function connectPostgres(url) {
  const { default: pg } = await import("pg");
  // Render's internal URLs need no TLS; external ones do.
  const ssl = /render\.com|sslmode=require/.test(url) ? { rejectUnauthorized: false } : undefined;
  const pool = new pg.Pool({ connectionString: url, ssl, max: 5 });
  const db = {
    query: async (sql, params) => (await pool.query(sql, params)).rows,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(async (sql, params) => (await client.query(sql, params)).rows);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
  await migrate(db);
  return db;
}

export async function connectMemory() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  const db = {
    query: async (sql, params) => (await pg.query(sql, params)).rows,
    tx: (fn) => pg.transaction((t) => fn(async (sql, params) => (await t.query(sql, params)).rows)),
    close: () => pg.close(),
  };
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.tx(async (q) => {
    for (const statement of SCHEMA_SQL) await q(statement);
  });
}
