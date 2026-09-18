import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 940 },
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: {
    command: process.env.LINCE_PREVIEW
      ? "npm run preview -- --host 127.0.0.1 --port 1420"
      : "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI && !process.env.LINCE_PREVIEW,
  },
});
