/** Apply SQL migrations in ./drizzle to DATABASE_URL (Postgres) or the local PGlite store. */
import { getDb } from "../src/db/client";
import { ensureDefaultStages } from "../src/db/seed-demo";

async function main() {
  const db = await getDb(); // PGlite migrates on open
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  }
  await ensureDefaultStages(db); // group-default workflow stages (configuration, not demo data)
  console.log("Migrations applied; default workflow stages present.");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
