/** Load the clearly-labelled DEMO dataset (synthetic, not Kun data). Re-running replaces demo rows only. */
import { getDb } from "../src/db/client";
import { seedDemo, DEMO_PASSWORD, removeDemoData, assertDemoAllowed } from "../src/db/seed-demo";

async function main() {
  // Removing demo data is always allowed; loading it is guarded.
  if (!process.argv.includes("--remove")) assertDemoAllowed();
  const db = await getDb();
  if (process.env.DATABASE_URL) {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  }
  if (process.argv.includes("--remove")) {
    await removeDemoData(db);
    console.log("Demo data removed.");
    process.exit(0);
  }
  const t = Date.now();
  const res = await seedDemo(db, { log: (m) => console.log(`  · ${m}`) });
  console.log(`\nDEMO dataset loaded in ${((Date.now() - t) / 1000).toFixed(1)}s:`, res);
  console.log(`\nSign in with any demo account, password: ${DEMO_PASSWORD}`);
  console.log("  md@demo.kun.local · finance@demo.kun.local · admin@demo.kun.local");
  console.log("  manager.bmw@demo.kun.local · advisor.bmw@demo.kun.local · tech1.bmw@demo.kun.local (also .hon .hyu .rr .vw .byd)");
  console.log("  sales1.hyu@demo.kun.local (sales consultant) · kiosk.hyu@demo.kun.local (showroom/lounge kiosk; also .hon .bmw .rr .vw .byd)");
  process.exit(0);
}
main().catch((e) => {
  console.error(String(e.cause?.message ?? e.message ?? e).slice(0, 2000));
  process.exit(1);
});
