import { defineConfig } from "@playwright/test";
const port = Number(process.env.LINCE_TEST_PORT || 1420);
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1440, height: 940 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: process.env.LINCE_PREVIEW
      ? `npm run preview -- --host 127.0.0.1 --port ${port}`
      : `npm run dev -- --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: !process.env.CI && !process.env.LINCE_PREVIEW,
  },
});
