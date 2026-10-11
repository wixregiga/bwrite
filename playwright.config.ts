import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Agents running acceptance tests side by side each pick their own port, and so their own folders.
const PORT = Number(process.env.BWRITE_E2E_PORT ?? 4317);
const BASE = path.join(realpathSync(tmpdir()), `bwrite-e2e-${PORT}`);
// The arclint launch root first, then the folder in BWrite's own format; the suites read them here.
const ROOTS = [path.join(BASE, "arclint-project"), path.join(BASE, "bwrite-project")].join(path.delimiter);
process.env.BWRITE_ROOTS = ROOTS;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  reporter: "list",
  // Creates the two Project folders and starts BWrite over them; see the file.
  webServer: {
    command: "node tests/support/e2e-server.ts",
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { BWRITE_E2E_BASE: BASE, BWRITE_E2E_PORT: String(PORT), BWRITE_ROOTS: ROOTS },
    gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
  },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
      testIgnore: /responsive\.test\.ts/,
    },
    { name: "narrow", use: { ...devices["Pixel 7"] }, testMatch: /responsive\.test\.ts/ },
  ],
});
