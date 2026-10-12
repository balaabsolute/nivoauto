import { getDb } from "@/db/client";
import { buildDashboard, type Dashboard } from "@/server/analytics";
import { resolvePeriod, businessDate } from "@/domain/periods";
import type { Actor } from "@/server/principal";
import { CATEGORY_ORDER, CATEGORY_LABELS } from "@/domain/revenue";
import { toCsv } from "@/lib/csv";

export async function dailyReportData(actor: Actor, date: string): Promise<{ day: Dashboard; mtd: Dashboard }> {
  const today = businessDate();
  const db = await getDb();
  const day = await buildDashboard(db, actor, resolvePeriod("custom", today, { start: date, end: date }), { syncAlerts: false });
  const mtd = await buildDashboard(db, actor, resolvePeriod("custom", today, { start: `${date.slice(0, 7)}-01`, end: date }), { syncAlerts: false });
  return { day, mtd };
}

export function dailyReportCsv(date: string, day: Dashboard, mtd: Dashboard, showFin: boolean): string {
  const header = ["Business date", "Dealership", "Brand", "Legal entity", "Location"];
  if (showFin) header.push(...CATEGORY_ORDER.map((c) => `${CATEGORY_LABELS[c]} revenue (day)`), "Total revenue (day)", "Gross profit (day)", "GP status (day)", "Total revenue (MTD)", "Target achievement MTD %");
  header.push("Vehicles delivered (day)", "Vehicles delivered (MTD)", "Leads", "Bookings", "Cancellations", "Service jobs opened", "Service jobs delivered", "Open service jobs", "Overdue jobs (all)", "Open body shop jobs", "Bay utilisation %", "Daily report submitted", "Demo data");
  const rows = day.dealers.map((r) => {
    const m = mtd.dealers.find((x) => x.dealer.id === r.dealer.id)!;
    const out: (string | number | null)[] = [date, r.dealer.name, r.dealer.brand, r.dealer.legalEntity, r.dealer.location];
    if (showFin) out.push(...CATEGORY_ORDER.map((c) => r.revenue.byCategory[c]), r.revenue.total, r.revenue.gp.amount, r.revenue.gp.status, m.revenue.total, m.revenueTargetAchievementPct);
    out.push(r.revenue.vehiclesDelivered, m.revenue.vehiclesDelivered, r.pipeline.leads, r.pipeline.bookings, r.pipeline.cancellations, r.service.opened, r.service.delivered, r.service.openAtEnd, r.service.overdueAtEnd + r.bodyshop.overdueAtEnd, r.dealer.hasBodyShop ? r.bodyshop.openAtEnd : null, r.capacity.service.utilisationPct, r.pipeline.reportsSubmitted > 0 ? "yes" : "no", r.dealer.isDemo ? "DEMO — illustrative, not Kun data" : "");
    return out;
  });
  return toCsv([header, ...rows]);
}
