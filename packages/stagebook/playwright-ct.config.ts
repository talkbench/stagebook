import { defineConfig, devices } from "@playwright/experimental-ct-react";

export default defineConfig({
  testDir: "./src",
  testMatch: "**/*.ct.tsx",
  snapshotDir: "./src/__snapshots__",
  timeout: 10_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    trace: "on-first-retry",
    ctPort: 3100,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
      // webkit's `browserContext.newPage()` is intermittently slow on
      // CI runners — see #457. Failures consistently shape as
      // `Test timeout of 10000ms exceeded while setting up "page"`,
      // not as test-body errors. Bumping the per-test timeout for
      // this project only (chromium and firefox stay at the 10s
      // default) masks the symptom while a real bootstrap-latency
      // investigation happens. If webkit suddenly gets healthy on
      // CI, this can drop back to the default.
      timeout: 30_000,
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
