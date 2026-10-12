import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { DATA_MODE } from "@/server/data-mode";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, dataMode: DATA_MODE, db: process.env.DATABASE_URL ? "postgres" : "pglite" });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
