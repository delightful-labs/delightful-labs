import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "./test-results/browser",
  workers: 1,
  use: { baseURL: process.env.BASE_URL || "http://localhost:5185/" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: "pnpm dev --port 5185 --strictPort",
        url: "http://localhost:5185/",
        reuseExistingServer: false,
        env: { LEAFLET_PUBLICATION_URI: "" },
      },
});
