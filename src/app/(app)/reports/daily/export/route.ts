import { NextResponse, type NextRequest } from "next/server";
import { getActor } from "@/server/auth";
import { can } from "@/domain/permissions";
import { addDays, businessDate, isIsoDate } from "@/domain/periods";
import { dailyReportData, dailyReportCsv } from "../report-data";

export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor || !can(actor, "dealership.dashboard")) return new NextResponse("Forbidden", { status: 403 });
  const q = req.nextUrl.searchParams.get("date");
  const date = isIsoDate(q) && q! <= businessDate() ? q! : addDays(businessDate(), -1);
  const { day, mtd } = await dailyReportData(actor, date);
  const csv = dailyReportCsv(date, day, mtd, can(actor, "financials.view"));
  return new NextResponse("﻿" + csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kun-daily-report-${date}.csv"` } });
}
