import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { users, userDealerships } from "@/db/schema";
import type { Principal } from "@/domain/permissions";
import type { Role } from "@/db/schema";

export interface Actor extends Principal {
  name: string;
  email: string;
}

export async function loadActor(db: DB, userId: string): Promise<Actor | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!u || !u.active) return null;
  const scopes = await db.select({ d: userDealerships.dealershipId }).from(userDealerships).where(eq(userDealerships.userId, userId));
  return { id: u.id, role: u.role as Role, name: u.name, email: u.email, dealershipIds: scopes.map((s) => s.d) };
}
