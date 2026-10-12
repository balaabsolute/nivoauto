import { defineConfig } from "@playwright/test";

/**
 * End-to-end smoke tests of the key journeys against a running app seeded with the demo dataset.
 *   npm run db:seed-demo && npm run build && npm run start   (in another terminal)
 *   npm run test:e2e
 * Set E2E_BASE_URL to target another environment. CHROMIUM_PATH can point at a local Chromium.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : undefined,
    trace: "retain-on-failure",
  },
});
