import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { can, ForbiddenError, type Capability } from "@/domain/permissions";
import { actorFromToken, SESSION_COOKIE } from "./session";
import type { Actor } from "./principal";

/** Current user for this request (cached per request). */
export const getActor = cache(async (): Promise<Actor | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return actorFromToken(await getDb(), token);
});

export async function requireActor(): Promise<Actor> {
  const a = await getActor();
  if (!a) redirect("/login");
  return a;
}

/** For pages: missing capability → friendly 403 page via notFound-like redirect. */
export async function requireCap(cap: Capability): Promise<Actor> {
  const a = await requireActor();
  if (!can(a, cap)) redirect("/forbidden");
  return a;
}

/** For server actions: throw instead of redirecting. */
export async function actorForAction(cap?: Capability): Promise<Actor> {
  const a = await getActor();
  if (!a) throw new ForbiddenError("Your session has expired — sign in again");
  if (cap && !can(a, cap)) throw new ForbiddenError();
  return a;
}
