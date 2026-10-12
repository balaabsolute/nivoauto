"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { login, logout, SESSION_COOKIE } from "@/server/session";
import { homePathFor } from "@/domain/permissions";
import { audit } from "@/server/audit";

// Simple in-memory throttle per email+IP (per server instance). Use a shared store behind a load balancer.
const attempts = new Map<string, { n: number; until: number }>();

export async function loginAction(_prev: { error?: string } | undefined, form: FormData): Promise<{ error?: string }> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${email}|${ip}`;
  const a = attempts.get(key);
  if (a && a.until > Date.now()) return { error: "Too many attempts. Wait a few minutes and try again." };
  if (!email || !password) return { error: "Enter your email and password." };

  const db = await getDb();
  const res = await login(db, email, password);
  if (!res) {
    const n = (a?.n ?? 0) + 1;
    attempts.set(key, { n, until: n >= 5 ? Date.now() + 5 * 60_000 : 0 });
    return { error: "Email or password is incorrect." };
  }
  attempts.delete(key);
  (await cookies()).set(SESSION_COOKIE, res.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    expires: res.expiresAt,
  });
  await audit(db, { userId: res.actor.id, action: "auth.login", entityType: "user", entityId: res.actor.id });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : homePathFor(res.actor));
}

export async function logoutAction() {
  const jar = await cookies();
  await logout(await getDb(), jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}
