// @ts-check
const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  projects: [
    {
      name: "r1-spike",
      testMatch: /r1-spike\.spec\.cjs/,
    },
  ],
});
