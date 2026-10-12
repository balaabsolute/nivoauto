import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { jobPhotos, jobs } from "@/db/schema";
import { getActor } from "@/server/auth";
import { canViewJob } from "@/domain/permissions";
import { readUpload } from "@/server/storage";

/** Serves a job photo only to users allowed to view that job. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getActor();
  if (!actor) return new NextResponse("Unauthorised", { status: 401 });
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select({ p: jobPhotos, j: jobs }).from(jobPhotos).innerJoin(jobs, eq(jobs.id, jobPhotos.jobId)).where(eq(jobPhotos.id, id));
  if (!row || !canViewJob(actor, row.j)) return new NextResponse("Not found", { status: 404 });
  const buf = await readUpload(row.p.storageKey);
  if (!buf) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(buf), { headers: { "content-type": row.p.contentType, "cache-control": "private, max-age=3600" } });
}
