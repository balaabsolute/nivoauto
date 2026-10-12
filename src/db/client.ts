import path from "node:path";
import fs from "node:fs";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

/**
 * Database access.
 *
 *  - DATABASE_URL set (postgres://…)  → node-postgres pool. Run `npm run db:migrate` on deploy.
 *  - DATABASE_URL unset               → embedded PGlite (real Postgres compiled to WASM) stored in
 *                                       PGLITE_DIR (default ./.data/pglite). Migrations run
 *                                       automatically on first access. For local dev / demo only.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

type Holder = { db?: Promise<DB>; override?: DB };
const g = globalThis as unknown as { __kunDb?: Holder };
const holder: Holder = (g.__kunDb ??= {});

export const MIGRATIONS_DIR = path.join(process.cwd(), "drizzle");

async function createPglite(dataDir: string | undefined): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as DB;
}

async function createPg(url: string): Promise<DB> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    ssl: process.env.DATABASE_SSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
  return drizzle(pool, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (holder.override) return Promise.resolve(holder.override);
  if (!holder.db) {
    const url = process.env.DATABASE_URL;
    if (!url && process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE !== "1" && process.env.NEXT_PHASE !== "phase-production-build") {
      throw new Error("DATABASE_URL is not set. Production requires PostgreSQL (set ALLOW_PGLITE=1 only for a single-machine demo).");
    }
    holder.db = url
      ? createPg(url)
      : createPglite(process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite"));
    holder.db.catch(() => (holder.db = undefined));
  }
  return holder.db;
}

/** Tests: use a fresh in-memory Postgres with migrations applied. */
export async function useInMemoryDbForTests(): Promise<DB> {
  const db = await createPglite(undefined);
  holder.override = db;
  return db;
}

export { schema };
