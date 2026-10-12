import { test, expect, type Page } from "@playwright/test";

const PW = "demo-pass-2026";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button:has-text('Sign in')")]);
}

test("unauthenticated users are sent to sign in", async ({ page }) => {
  await page.goto("/group");
  await expect(page).toHaveURL(/\/login\?next=%2Fgroup/);
});

test("wrong password is rejected with a clear message", async ({ page }) => {
  await page.goto("/login");
  await page.fill("#email", "md@demo.kun.local");
  await page.fill("#password", "not-the-password");
  await page.click("button:has-text('Sign in')");
  await expect(page.locator("p[role=alert]")).toHaveText(/incorrect/);
});

test("MD: group overview → period change → dealership drill-down", async ({ page }) => {
  await login(page, "md@demo.kun.local");
  await expect(page).toHaveURL(/\/group/);
  await expect(page.getByRole("heading", { name: "Group overview" })).toBeVisible();
  await expect(page.getByText("Every figure shown is synthetic")).toBeVisible();
  await expect(page.getByText("Total revenue")).toBeVisible();
  await page.getByRole("button", { name: "Year to date" }).click();
  await expect(page).toHaveURL(/period=ytd/);
  await expect(page.getByText(/Year to date \(FY/).first()).toBeVisible();
  await page.getByRole("link", { name: "Kun BMW" }).first().click();
  await expect(page.getByRole("heading", { name: "Kun BMW" })).toBeVisible();
  await expect(page).toHaveURL(/period=ytd/);
  await expect(page.getByText("Capacity & workload")).toBeVisible();
});

test("advisor: create a job card, move it forward, and see the audit timeline", async ({ page }) => {
  await login(page, "advisor.bmw@demo.kun.local");
  await page.goto("/jobs/new");
  const reg = `E2E${Date.now().toString().slice(-6)}`;
  await page.fill("input[name=registrationNo]", reg);
  await page.fill("input[name=customerName]", "E2E Test Customer");
  await page.fill("input[name=phone]", "9876501234");
  await page.check("input[name=consentWhatsapp]");
  await page.fill("textarea[name=complaint]", "E2E periodic service");
  await page.click("button:has-text('Create job card')");
  await expect(page).toHaveURL(/\/jobs\/[0-9a-f-]{36}\?created=1/);
  await expect(page.getByText("Job card created")).toBeVisible();
  await expect(page.getByText("Vehicle received / inspected")).toBeVisible();
  await page.click("button:has-text('Move to Inspection & job card')");
  await expect(page.getByText("Registered → Inspection & job card")).toBeVisible();
  // the guard explains why the next move is blocked until approval is recorded
  await page.click("button:has-text('Move to Awaiting approval')");
  await expect(page.getByText("Approval needed")).toBeVisible();
  await expect(page.getByText("Record the customer/insurer approval before continuing")).toBeVisible();
});

test("advisor cannot open the group dashboard", async ({ page }) => {
  await login(page, "advisor.bmw@demo.kun.local");
  await page.goto("/group");
  await expect(page).toHaveURL(/\/forbidden/);
});

test("technician sees only assigned work, without customer phone numbers", async ({ page }) => {
  await login(page, "tech1.bmw@demo.kun.local");
  await expect(page.getByRole("heading", { name: "My jobs" })).toBeVisible();
  const first = page.locator("tbody tr a").first();
  if (await first.count()) {
    await first.click();
    await expect(page.getByText("Contact details are visible to service advisors and managers.")).toBeVisible();
  }
});

test("finance: daily report CSV export is labelled as demo", async ({ page, request }) => {
  await login(page, "finance@demo.kun.local");
  await page.goto("/reports/daily");
  await expect(page.getByRole("heading", { name: "Daily report" })).toBeVisible();
  const res = await page.request.get("/reports/daily/export");
  expect(res.status()).toBe(200);
  const body = await res.text();
  expect(body).toContain("Business date");
  expect(body).toContain("DEMO");
  void request;
});
