import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { verifyPassword } from "./password";
import { loadActor, type Actor } from "./principal";

export const SESSION_COOKIE = "kun_session";
export const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 12);

const sha = (t: string) => createHash("sha256").update(t).digest("hex");

export async function login(db: DB, email: string, password: string): Promise<{ token: string; actor: Actor; expiresAt: Date } | null> {
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`).limit(1);
  // Always run a verify to keep timing similar for unknown users.
  const ok = await verifyPassword(password, u?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u || !u.active || !ok) return null;
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3_600_000);
  await db.insert(sessions).values({ id: sha(token), userId: u.id, expiresAt });
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id));
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date())); // housekeeping
  const actor = await loadActor(db, u.id);
  return actor ? { token, actor, expiresAt } : null;
}

export async function actorFromToken(db: DB, token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const [s] = await db
    .select()
    .from(sessions)
    .where(and(eq(sessions.id, sha(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!s) return null;
  return loadActor(db, s.userId);
}

export async function logout(db: DB, token: string | undefined): Promise<void> {
  if (token) await db.delete(sessions).where(eq(sessions.id, sha(token)));
}

export async function revokeUserSessions(db: DB, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
