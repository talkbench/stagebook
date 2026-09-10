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
    // Playwright CT connects to whatever is already listening on `ctPort`
    // instead of failing, so a concurrent CT run elsewhere on the machine
    // silently serves this suite ITS component registry ("Unregistered
    // component" errors that look like defects in the component under test,
    // or worse, a green run against a different source tree). 3100 is both
    // Playwright's default and what sibling repos (talkbench/runner) use, so
    // default to a repo-distinct port and let a second worktree of this repo
    // pick its own: `PW_CT_PORT=3123 npm run test:ct`. See #603.
    ctPort: Number(process.env.PW_CT_PORT || 3110),
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"] },
    },
  ],
});
