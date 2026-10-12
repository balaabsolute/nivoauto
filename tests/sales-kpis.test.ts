import { describe, it, expect } from "vitest";
import { salesKpis, prospectKpis, type KLead, type SalesInput, type KProspect } from "@/domain/sales-kpis";

const d = (s: string) => new Date(`${s}T06:00:00Z`);
const R = { from: d("2026-10-01"), to: d("2026-11-01") };
const CMP = { from: d("2026-09-01"), to: d("2026-10-01") };
const NOW = d("2026-10-15");
const lead = (id: string, p: Partial<KLead>): KLead => ({ id, createdAt: d("2026-10-02"), closedAt: null, status: "open", source: "walk_in", consultantId: "c1", timeframe: null, lostToBrand: null, nurtureEligible: true, ...p });
const base = (p: Partial<SalesInput>): SalesInput => ({ leads: [], drives: [], followUps: [], nurtureMessages: [], updatesPublished: [], activities: [], interests: [], consultants: [{ id: "c1", name: "A" }], ...p });

describe("salesKpis", () => {
  it("counts enquiries created, test drives, wins and close rate within the period", () => {
    const k = salesKpis(base({
      leads: [
        lead("a", {}),
        lead("b", { status: "won", closedAt: d("2026-10-10") }),
        lead("c", { status: "lost_other_dealer", closedAt: d("2026-10-11"), lostToBrand: "Kia" }),
        lead("old", { createdAt: d("2026-09-05"), status: "won", closedAt: d("2026-10-03") }), // created last month, won this month
        lead("prev", { createdAt: d("2026-09-10") }),
      ],
      drives: [{ leadId: "a", status: "completed", completedAt: d("2026-10-03") }, { leadId: "prev", status: "completed", completedAt: d("2026-09-12") }],
    }), R, CMP, NOW);
    expect(k.enquiries).toBe(3);
    expect(k.enquiriesGrowthPct).toBe(50); // 3 vs 2
    expect(k.testDrives).toBe(1);
    expect(k.testDriveRatePct).toBe(33.3); // a of a,b,c
    expect(k.won).toBe(2);
    expect(k.closeRatePct).toBe(66.7); // 2 won of 3 closed
    expect(k.lostBrands).toEqual([{ key: "Kia", n: 1 }]);
    expect(k.medianDaysToWin).toBe(18); // median of 8 and 28 days
  });

  it("measures follow-up discipline on follow-ups due in the period", () => {
    const k = salesKpis(base({
      leads: [lead("a", {})],
      followUps: [
        { leadId: "a", dueAt: d("2026-10-05"), status: "done", completedAt: d("2026-10-05"), assignedToId: "c1", fromUpdate: false },
        { leadId: "a", dueAt: d("2026-10-06"), status: "done", completedAt: d("2026-10-09"), assignedToId: "c1", fromUpdate: true },
        { leadId: "a", dueAt: d("2026-10-07"), status: "open", completedAt: null, assignedToId: "c1", fromUpdate: false },
        { leadId: "a", dueAt: d("2026-12-01"), status: "open", completedAt: null, assignedToId: "c1", fromUpdate: false }, // not due in period
      ],
    }), R, CMP, NOW);
    expect(k.followUps.due).toBe(3);
    expect(k.followUps.completionPct).toBe(66.7);
    expect(k.followUps.onTimePct).toBe(33.3); // only the first was done within a day of due
    expect(k.pipeline.overdueFollowUps).toBe(1); // due 7 Oct, still open on 15 Oct
    expect(k.nurture.callTasksDonePct).toBe(100);
  });

  it("credits nurture only for engagement AFTER the update was received", () => {
    const k = salesKpis(base({
      leads: [lead("a", {}), lead("b", { status: "won", closedAt: d("2026-10-12") }), lead("c", {})],
      nurtureMessages: [
        { leadId: "a", customerId: "x", createdAt: d("2026-10-08"), status: "sent" },
        { leadId: "b", customerId: "y", createdAt: d("2026-10-08"), status: "sent" },
        { leadId: "c", customerId: "z", createdAt: d("2026-10-08"), status: "skipped" },
      ],
      activities: [{ leadId: "a", type: "call", at: d("2026-10-07"), userId: "c1" }], // before the update → not engagement
    }), R, CMP, NOW);
    expect(k.nurture.messagesSent).toBe(2);
    expect(k.nurture.messagesSkippedOrFailed).toBe(1);
    expect(k.nurture.enquiriesReached).toBe(2);
    expect(k.nurture.engagedAfter).toBe(1);
    expect(k.nurture.wonAfter).toBe(1);
  });

  it("reports hours to first contact for enquiries created in the period", () => {
    const k = salesKpis(base({
      leads: [lead("a", { createdAt: new Date("2026-10-02T06:00:00Z") }), lead("b", { createdAt: new Date("2026-10-02T06:00:00Z") })],
      activities: [{ leadId: "a", type: "call", at: new Date("2026-10-02T08:00:00Z"), userId: "c1" }, { leadId: "b", type: "call", at: new Date("2026-10-04T06:00:00Z"), userId: "c1" }],
    }), R, CMP, NOW);
    expect(k.medianHoursToFirstContact).toBe(25);
    expect(k.contactedWithin24hPct).toBe(50);
  });
});

describe("prospectKpis", () => {
  const p = (x: Partial<KProspect>): KProspect => ({ createdAt: d("2026-10-03"), interest: "yes", timeframe: "1_3m", purchaseYear: 2019, budgetBand: "15_25l", serviceRating: 4, status: "new", marketingOk: true, currentMake: "Honda", preferredBrands: ["Honda"], preferredModels: ["Honda Elevate"], convertedLead: null, messagedAt: [], ...x });
  it("tags upgrade candidates, readiness, cross-brand interest and conversions", () => {
    const k = prospectKpis([
      p({}),
      p({ purchaseYear: 2024, interest: "maybe", timeframe: "6_12m", preferredBrands: ["BMW"], preferredModels: ["BMW X1"] }),
      p({ interest: "no", timeframe: "not_planning", preferredBrands: [], preferredModels: [], marketingOk: false }),
      p({ status: "converted", convertedLead: { createdAt: d("2026-10-05"), status: "won", closedAt: d("2026-10-20") } }),
      p({ createdAt: d("2026-09-10") }),
    ], R, CMP, 2026, 5);
    expect(k.responses).toBe(4);
    expect(k.responsesGrowthPct).toBe(300);
    expect(k.upgradeDue).toBe(3);
    expect(k.readyIn3Months).toBe(2);
    expect(k.crossBrand).toBe(1);
    expect(k.convertedToEnquiry).toBe(1);
    expect(k.convertedWon).toBe(1);
    expect(k.conversionPct).toBe(33.3); // 1 converted of 3 interested
  });
});
