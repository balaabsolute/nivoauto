/**
 * Create the first real (non-demo) user, e.g. the administrator:
 *   npm run user:create -- --email admin@kun.example --name "Jane Admin" --role admin
 * The password is read from the KUN_NEW_USER_PASSWORD environment variable (not the command line).
 */
import { getDb } from "../src/db/client";
import { users, userDealerships, dealerships, ROLES, type Role } from "../src/db/schema";
import { hashPassword } from "../src/server/password";
import { audit } from "../src/server/audit";
import { inArray } from "drizzle-orm";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg("email")?.toLowerCase();
  const name = arg("name");
  const role = arg("role") as Role;
  const codes = arg("dealerships")?.split(",").map((c) => c.trim().toUpperCase()) ?? [];
  const password = process.env.KUN_NEW_USER_PASSWORD;
  if (!email || !name || !ROLES.includes(role) || !password) {
    console.error(`Usage: KUN_NEW_USER_PASSWORD=… npm run user:create -- --email x --name "X" --role ${ROLES.join("|")} [--dealerships CODE1,CODE2]`);
    process.exit(1);
  }
  const db = await getDb();
  const [u] = await db.insert(users).values({ email, name, role, passwordHash: await hashPassword(password) }).returning();
  if (codes.length) {
    const ds = await db.select().from(dealerships).where(inArray(dealerships.code, codes));
    if (ds.length) await db.insert(userDealerships).values(ds.map((d) => ({ userId: u.id, dealershipId: d.id })));
  }
  await audit(db, { userId: null, action: "user.create_cli", entityType: "user", entityId: u.id, after: { email, role, dealerships: codes } });
  console.log(`Created ${role} ${email}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
