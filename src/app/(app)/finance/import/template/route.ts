import { NextResponse } from "next/server";
import { IMPORT_COLUMNS } from "@/server/services/finance";

export async function GET() {
  const example = [
    IMPORT_COLUMNS.join(","),
    "2026-10-01,HON,vehicle_sales,invoice,,1150000,322000,1090000,1,INV-1001,DMS-INV-1001",
    "2026-10-01,HON,service_labour,invoice,,4200,756,,,INV-2001,DMS-INV-2001-L",
    "2026-10-01,HON,parts,invoice,workshop,3800,1064,2850,,INV-2001,DMS-INV-2001-P",
    "2026-10-01,HON,vehicle_sales,booking_advance,,50000,,,,ADV-77,DMS-ADV-77",
  ].join("\r\n");
  return new NextResponse("﻿" + example + "\r\n", { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="kun-revenue-import-template.csv"' } });
}
