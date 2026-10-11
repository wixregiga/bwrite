import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import { mountApi } from "./server/app/vocabulary-server";

/** BWrite's API on the Vite dev server and on `vite preview`. */
function bwriteApi(): Plugin {
  return {
    name: "bwrite-api",
    configureServer: mountApi,
    configurePreviewServer: mountApi,
  };
}

export default defineConfig({
  plugins: [react(), bwriteApi()],
  test: {
    include: ["src/**/*.test.ts", "server/**/*.test.ts", "tests/integration/**/*.test.ts"],
    environment: "node",
  },
});
