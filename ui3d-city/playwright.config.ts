import { defineConfig } from "@playwright/test";

// The visual captures (home, the toll during the analysis, the scrapyard at the crush). They drive the installed
// Chrome, with a GPU path for WebGL; the app runs offline on its snapshots (npm run dev, or started here).
export default defineConfig({
  testDir: "tests/visual",
  timeout: 120_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    viewport: { width: 1920, height: 1080 },
    launchOptions: { args: [process.platform === "win32" ? "--use-angle=d3d11" : "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] },
  },
  webServer: { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 180_000 },
});
