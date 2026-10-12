import { test, expect, type Page } from "@playwright/test";

const PW = "demo-pass-2026";
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", PW);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click("button:has-text('Sign in')")]);
}

test("showroom kiosk → front desk → enquiry → test drive → bought elsewhere", async ({ browser }) => {
  const name = `E2E Kiosk ${Date.now().toString().slice(-5)}`;
  const phone = `98${Date.now().toString().slice(-8)}`;

  // 1. Customer checks in on the tablet / TV kiosk
  const kioskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const kiosk = await kioskCtx.newPage();
  await login(kiosk, "kiosk.vw@demo.kun.local");
  await expect(kiosk).toHaveURL(/\/kiosk$/);
  await kiosk.getByRole("button", { name: /New car enquiry/ }).click();
  await kiosk.getByRole("button", { name: /Taigun/ }).click();
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await kiosk.getByRole("button", { name: /Yes, please/ }).click();
  await kiosk.getByRole("button", { name: "Continue" }).click();
  await kiosk.getByLabel("Your name").fill(name);
  await kiosk.getByLabel("Mobile number").fill(phone);
  await kiosk.getByRole("button", { name: "Get my token" }).click();
  await expect(kiosk.getByText("Your token")).toBeVisible();
  const token = (await kiosk.locator("p.num").first().textContent())!.trim();
  expect(token).toMatch(/^N-\d{3}$/);
  // The kiosk never shows staff screens
  await kiosk.goto("/front-desk");
  await expect(kiosk).toHaveURL(/\/kiosk/);
  await kioskCtx.close();

  // 2. Manager sees the visitor at the front desk and opens the enquiry
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "manager.vw@demo.kun.local");
  await page.goto("/front-desk");
  const row = page.locator("li", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText(token)).toBeVisible();
  await row.getByRole("button", { name: "Attend" }).click();
  await expect(page.locator("li", { hasText: name }).getByRole("link", { name: "Open enquiry" })).toBeVisible();
  await page.locator("li", { hasText: name }).getByRole("link", { name: "Open enquiry" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
  await expect(page.getByText("Taigun · primary")).toBeVisible();

  // 3. The requested test drive is completed (licence check is mandatory)
  await page.getByText("Record as completed").click();
  await page.getByLabel(/Driving licence checked/).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("completed", { exact: true })).toBeVisible();
  await expect(page.getByText("Test drive completed: Taigun")).toBeVisible();

  // 4. Customer bought another brand elsewhere → enquiry closes, nurture stops
  await page.getByText("Bought elsewhere").click();
  await page.getByLabel("Brand *").fill("Unknown");
  await page.getByRole("button", { name: "Record" }).first().click();
  await expect(page.getByText(/No further follow-ups or model updates/)).toBeVisible();
  await expect(page.getByText("Close enquiry")).toHaveCount(0);
  await ctx.close();
});

test("sales consultant sees enquiries but not the kiosk or admin", async ({ page }) => {
  await login(page, "sales1.hyu@demo.kun.local");
  await expect(page).toHaveURL(/\/leads/);
  await expect(page.getByRole("heading", { name: "Car enquiries" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin$/);
});

test("lounge feedback lands in future prospects", async ({ browser }) => {
  const name = `E2E Lounge ${Date.now().toString().slice(-5)}`;
  const kctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const k = await kctx.newPage();
  await login(k, "kiosk.hon@demo.kun.local");
  await k.goto("/kiosk/lounge");
  await k.getByRole("button", { name: /Tap to start/ }).click();
  await k.getByRole("button", { name: "Honda" }).click();
  await k.getByRole("button", { name: "2017" }).click();
  await k.getByRole("button", { name: "Continue" }).click();
  await k.getByRole("button", { name: /Yes, I’m looking/ }).click();
  await k.getByRole("button", { name: "Continue" }).click();
  await k.getByRole("button", { name: "1–3 months" }).click();
  await k.getByRole("button", { name: "Continue" }).click();
  await k.getByLabel("Your name").fill(name);
  await k.getByLabel("Mobile number").fill(`97${Date.now().toString().slice(-8)}`);
  await k.getByRole("button", { name: "Submit" }).click();
  await expect(k.getByText(/Thank you/)).toBeVisible();
  await kctx.close();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await login(page, "manager.hon@demo.kun.local");
  await page.goto("/prospects?upgrade=1");
  const row = page.locator("li", { hasText: name });
  await expect(row).toBeVisible();
  await expect(row.getByText(/Upgrade due/)).toBeVisible();
  await row.getByRole("button", { name: "Create enquiry" }).click();
  await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}/);
  await expect(page.getByText(/Converted from lounge feedback/)).toBeVisible();
  await ctx.close();
});
