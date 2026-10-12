import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/db/client";
import { logout, SESSION_COOKIE } from "@/server/session";

export async function POST(req: NextRequest) {
  await logout(await getDb(), req.cookies.get(SESSION_COOKIE)?.value);
  const res = NextResponse.redirect(new URL("/login", req.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
