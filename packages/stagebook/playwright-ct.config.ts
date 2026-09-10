import { defineConfig, devices } from "@playwright/experimental-ct-react";

// Validated rather than coerced: `Number("3l23")` is NaN, which ct-core
// treats as unset and quietly falls back to 3100 — the shared port this
// override exists to escape — with no sign the value was ignored.
const rawCtPort = process.env.PW_CT_PORT;
const ctPort = rawCtPort ? Number(rawCtPort) : 3110;
if (!Number.isInteger(ctPort) || ctPort < 1 || ctPort > 65535) {
  throw new Error(
    `PW_CT_PORT must be a port number (1-65535), got ${JSON.stringify(rawCtPort)}`,
  );
}

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
    ctPort,
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
