/**
 * DATA_MODE=live must exclude demo records everywhere and refuse demo seeding.
 * Modules are imported after setting the env var (DATA_MODE is read at module load).
 */
import { describe, it, expect, beforeAll } from "vitest";

process.env.DATA_MODE = "live";

describe("live mode separates demo data", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  async function setup() {
    const { useInMemoryDbForTests } = await import("@/db/client");
    const s = await import("@/db/schema");
    const { ensureDefaultStages, seedDemo, assertDemoAllowed } = await import("@/db/seed-demo");
    const { buildDashboard } = await import("@/server/analytics");
    const { listJobs } = await import("@/server/services/jobs");
    const { resolvePeriod, businessDate, addDays } = await import("@/domain/periods");
    const db = await useInMemoryDbForTests();
    await ensureDefaultStages(db);
    // A demo dealership with a demo revenue line, and a real dealership with a real line.
    const [le] = await db.insert(s.legalEntities).values({ code: "R1", name: "Real entity" }).returning();
    const [leD] = await db.insert(s.legalEntities).values({ code: "D1", name: "Demo entity", isDemo: true }).returning();
    const [b] = await db.insert(s.brands).values({ name: "RealBrand" }).returning();
    const [real] = await db.insert(s.dealerships).values({ code: "REAL", name: "Real dealer", brandId: b.id, legalEntityId: le.id, locationName: "L" }).returning();
    const [demo] = await db.insert(s.dealerships).values({ code: "DEMO", name: "Demo dealer", brandId: b.id, legalEntityId: leD.id, locationName: "L", isDemo: true }).returning();
    const y = addDays(businessDate(), -1);
    const base = { businessDate: y, category: "parts" as const, partsChannel: "retail" as const, kind: "invoice" as const, source: "manual" as const, directCostAmount: null };
    await db.insert(s.transactions).values([
      { ...base, dealershipId: real.id, legalEntityId: le.id, brandId: b.id, revenueAmount: 100, sourceRef: "r1" },
      { ...base, dealershipId: demo.id, legalEntityId: leD.id, brandId: b.id, revenueAmount: 999_999, sourceRef: "d1", isDemo: true },
    ]);
    const md = { id: "00000000-0000-0000-0000-000000000000", role: "md" as const, dealershipIds: [], name: "MD", email: "md@x" };
    const { hashPassword } = await import("@/server/password");
    const pw = await hashPassword("correct-horse-battery");
    await db.insert(s.users).values([
      { email: "demo-md@x.local", name: "Demo MD", role: "md", passwordHash: pw, isDemo: true },
      { email: "real-md@x.local", name: "Real MD", role: "md", passwordHash: pw },
    ]);
    const { login } = await import("@/server/session");
    return { login, db, seedDemo, assertDemoAllowed, buildDashboard, listJobs, resolvePeriod, businessDate, y, md };
  }
  beforeAll(async () => {
    ctx = await setup();
  });

  it("refuses to seed demo data", async () => {
    expect(() => ctx.assertDemoAllowed()).toThrow(/DATA_MODE=live/);
    await expect(ctx.seedDemo(ctx.db)).rejects.toThrow(/DATA_MODE=live/);
  });

  it("demo accounts cannot sign in against live data", async () => {
    expect(await ctx.login(ctx.db, "demo-md@x.local", "correct-horse-battery")).toBeNull();
    expect((await ctx.login(ctx.db, "real-md@x.local", "correct-horse-battery"))?.actor.role).toBe("md");
  });

  it("dashboards show only real dealerships and real records", async () => {
    const p = ctx.resolvePeriod("custom", ctx.businessDate(), { start: ctx.y, end: ctx.y });
    const d = await ctx.buildDashboard(ctx.db, ctx.md, p, { requires: "group.dashboard", syncAlerts: false });
    expect(d.dealers.map((r) => r.dealer.code)).toEqual(["REAL"]);
    expect(d.total.revenue.total).toBe(100);
    expect(d.containsDemo).toBe(false);
  });
});
