import { defineConfig } from "vitest/config";

// fileParallelism: the e2e suites all drive one local Ollama instance.
// Running the test files in parallel multiplies its latency past every
// per-attempt timeout and the whole suite collapses — keep them serial.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    fileParallelism: false,
  },
});
