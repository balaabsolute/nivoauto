import { describe, it, expect } from "vitest";
import {
  formatToken, validateClose, canChangeStage, nurtureBlocker, hasMarketingPermission, prospectMatchesModel, ownershipYears,
  isUpgradeCandidate, prospectScore, funnel, defaultFollowUpAt, type ContactProfile,
} from "@/domain/crm";
import { can, homePathFor, type Principal } from "@/domain/permissions";
import { renderTemplate } from "@/domain/notifications";

const contact = (o: Partial<ContactProfile> = {}): ContactProfile => ({
  consentMarketing: true, marketingOptOutAt: null, consentWhatsapp: true, consentSms: false, consentEmail: false, phone: "+919800000000", email: null, ...o,
});

describe("front-desk tokens", () => {
  it("prefix by visit type, zero-padded", () => {
    expect(formatToken("new_car", 7)).toBe("N-007");
    expect(formatToken("service", 12)).toBe("S-012");
    expect(formatToken("spare_parts", 1)).toBe("P-001");
    expect(formatToken("body_shop", 120)).toBe("B-120");
  });
});

describe("enquiry lifecycle", () => {
  it("closing outcomes need the right details", () => {
    expect(validateClose("open", { status: "won" })).toEqual([]);
    expect(validateClose("open", { status: "lost_other_dealer" })[0]).toMatch(/which brand/);
    expect(validateClose("open", { status: "lost_other_dealer", lostToBrand: "Other brand", lostToModel: "Any" })).toEqual([]);
    expect(validateClose("open", { status: "not_interested" })[0]).toMatch(/reason/);
    expect(validateClose("open", { status: "opted_out" })).toEqual([]);
    expect(validateClose("won", { status: "won" })[0]).toMatch(/already closed/);
  });
  it("stage changes only while open", () => {
    expect(canChangeStage("open", "enquiry", "test_drive")).toBeNull();
    expect(canChangeStage("won", "enquiry", "test_drive")).toMatch(/Closed/);
    expect(canChangeStage("open", "booked", "booked")).toMatch(/Already/);
  });
  it("default follow-up cadence", () => {
    const t = new Date("2026-10-12T05:00:00Z");
    expect(defaultFollowUpAt("enquiry", t).toISOString()).toBe("2026-10-13T05:00:00.000Z");
    expect(defaultFollowUpAt("test_drive", t).toISOString()).toBe("2026-10-14T05:00:00.000Z");
  });
});

describe("nurture eligibility (stops on any outcome, needs marketing consent)", () => {
  it("open + marketing consent + consented channel = eligible", () => {
    expect(nurtureBlocker("open", contact())).toBeNull();
  });
  it("every closing outcome stops nurture", () => {
    for (const s of ["won", "lost_other_dealer", "not_interested", "opted_out"] as const) expect(nurtureBlocker(s, contact())).toBe("closed");
  });
  it("needs marketing consent, respects opt-out, needs a usable channel", () => {
    expect(nurtureBlocker("open", contact({ consentMarketing: false }))).toBe("no_marketing_consent");
    expect(nurtureBlocker("open", contact({ marketingOptOutAt: new Date() }))).toBe("opted_out");
    expect(nurtureBlocker("open", contact({ consentWhatsapp: false }))).toBe("no_channel");
    expect(nurtureBlocker("open", contact({ consentWhatsapp: false, consentEmail: true, email: "a@b.c" }))).toBeNull();
    expect(hasMarketingPermission(contact({ phone: null }))).toBe(false);
  });
});

describe("lounge prospects", () => {
  it("ownership years and the 5-year upgrade tag", () => {
    expect(ownershipYears(2019, "2026-10-12")).toBe(7);
    expect(ownershipYears(2030, "2026-10-12")).toBeNull();
    expect(ownershipYears(null, "2026-10-12")).toBeNull();
    expect(isUpgradeCandidate(2021, "2026-10-12")).toBe(true);
    expect(isUpgradeCandidate(2022, "2026-10-12")).toBe(false);
  });
  it("model matching excludes not-interested, not-planning and converted prospects", () => {
    const p = { interest: "maybe" as const, timeframe: "3_6m" as const, status: "new" as const, preferredModelIds: ["m1"] };
    expect(prospectMatchesModel(p, "m1")).toBe(true);
    expect(prospectMatchesModel(p, "m2")).toBe(false);
    expect(prospectMatchesModel({ ...p, interest: "no" }, "m1")).toBe(false);
    expect(prospectMatchesModel({ ...p, timeframe: "not_planning" }, "m1")).toBe(false);
    expect(prospectMatchesModel({ ...p, status: "converted" }, "m1")).toBe(false);
  });
  it("warmer prospects score higher", () => {
    const hot = prospectScore({ interest: "yes", timeframe: "within_1m", purchaseYear: 2017 }, "2026-10-12");
    const cold = prospectScore({ interest: "maybe", timeframe: "12m_plus", purchaseYear: 2023 }, "2026-10-12");
    expect(hot).toBeGreaterThan(cold);
  });
});

describe("showroom funnel", () => {
  const d = (s: string) => new Date(s);
  const range = { from: d("2026-10-01T00:00:00Z"), to: d("2026-11-01T00:00:00Z") };
  it("counts walk-ins, enquiries, test drives and outcomes closed in the period", () => {
    const f = funnel(
      {
        walkIns: [
          { visitType: "new_car", createdAt: d("2026-10-02T05:00:00Z") },
          { visitType: "service", createdAt: d("2026-10-03T05:00:00Z") },
          { visitType: "service", createdAt: d("2026-09-30T05:00:00Z") }, // outside
        ],
        leads: [
          { createdAt: d("2026-10-02T05:00:00Z"), closedAt: d("2026-10-20T05:00:00Z"), status: "won", hadTestDrive: true },
          { createdAt: d("2026-10-05T05:00:00Z"), closedAt: d("2026-10-25T05:00:00Z"), status: "lost_other_dealer", hadTestDrive: false },
          { createdAt: d("2026-09-10T05:00:00Z"), closedAt: d("2026-10-02T05:00:00Z"), status: "not_interested", hadTestDrive: false },
          { createdAt: d("2026-10-10T05:00:00Z"), closedAt: null, status: "open", hadTestDrive: true },
          { createdAt: d("2026-09-01T05:00:00Z"), closedAt: d("2026-11-05T05:00:00Z"), status: "won", hadTestDrive: false }, // open at period end
        ],
        testDrivesCompleted: [{ completedAt: d("2026-10-03T05:00:00Z") }, { completedAt: d("2026-10-11T05:00:00Z") }],
      },
      range,
    );
    expect(f.walkIns).toEqual({ new_car: 1, service: 1, spare_parts: 0, body_shop: 0 });
    expect(f.enquiries).toBe(3);
    expect(f.testDrives).toBe(2);
    expect([f.won, f.lostOtherDealer, f.notInterested, f.closed]).toEqual([1, 1, 1, 3]);
    expect(f.closeRatePct).toBe(33.3);
    expect(f.testDriveRatePct).toBe(66.7);
    expect(f.openAtEnd).toBe(2);
  });
});

describe("roles", () => {
  const kiosk: Principal = { id: "k", role: "kiosk", dealershipIds: ["d1"] };
  const sc: Principal = { id: "s", role: "sales_consultant", dealershipIds: ["d1"] };
  it("kiosk devices can only submit", () => {
    expect(can(kiosk, "kiosk.submit")).toBe(true);
    for (const c of ["leads.view", "jobs.view", "customers.contact", "frontdesk.view", "group.dashboard"] as const) expect(can(kiosk, c)).toBe(false);
    expect(homePathFor(kiosk)).toBe("/kiosk");
  });
  it("sales consultants work enquiries but can't publish updates or see financials", () => {
    expect(can(sc, "leads.manage")).toBe(true);
    expect(can(sc, "model_updates.manage")).toBe(false);
    expect(can(sc, "leads.assign")).toBe(false);
    expect(can(sc, "financials.view")).toBe(false);
    expect(homePathFor(sc)).toBe("/leads");
  });
});

describe("nurture templates", () => {
  it("include opt-out instructions", () => {
    expect(renderTemplate("model_update", { customerName: "A", dealershipName: "D", models: "Creta", updateTitle: "Festive offer", updateMessage: "Benefits up to ₹50,000." })).toMatch(/Reply STOP/);
    expect(renderTemplate("enquiry_received", { customerName: "A", dealershipName: "D", models: "Creta, Venue" })).toContain("Creta, Venue");
  });
});
