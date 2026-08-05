import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.JOYNO_SMOKE_PORT || 4173);
const baseURL = process.env.JOYNO_SMOKE_BASE_URL || `http://127.0.0.1:${port}`;
const browserExecutable = process.env.JOYNO_BROWSER_EXECUTABLE;

export default defineConfig({
  testDir: "./tests/smoke",
  timeout: 30_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: browserExecutable ? "off" : "retain-on-failure"
  },
  webServer: {
    command: `npx http-server public -p ${port} -c-1 --silent`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(browserExecutable ? { launchOptions: { executablePath: browserExecutable } } : {})
      }
    }
  ]
});
