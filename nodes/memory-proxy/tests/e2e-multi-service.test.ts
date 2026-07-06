/**
 * E2E: multi-service chain.
 *
 * The brain must combine two services in one session:
 * 1. Run a shell command that outputs a random token
 * 2. Store the result in memory
 * 3. We verify the token ended up in memory.json
 *
 * This tests the brain's ability to chain tool calls across iterations.
 *
 * Requires: Ollama running with the test model.
 */
import { describe, it, expect, afterEach } from "vitest";
import { BrainService, LLMRegistry, getNodeDataRoot } from "@brain/core";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { allStoreprojectNodeDirs } from "./_helpers/storeprojects-dirs";

const TEST_MODEL = "ollama/gemma4:e4b";
const TIMEOUT = 90_000;
const MAX_ATTEMPTS = 3;

async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (!res.ok) return false;
    const data = await res.json() as { models: Array<{ name: string }> };
    return data.models.some((m) => m.name.includes("gemma4"));
  } catch {
    return false;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => { setTimeout(r, ms); });
}

describe("e2e: multi-service chain", async () => {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) {
    it.skip("Ollama not available", () => {});
    return;
  }

  let brain: BrainService | null = null;
  // The memory node persists inside its per-instance ctx.dataDir
  // (<data>/nodes/<id>/memory.json) — that's the file to watch, not the
  // legacy shared data/memory.json.
  let memPath = "";
  const spawnedDataDirs: string[] = [];
  afterEach(() => {
    try { brain?.killAll(); } catch { /* */ }
    brain = null;
    for (const dir of spawnedDataDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  async function freshSetup(): Promise<BrainService> {
    const b = new BrainService(":memory:");
    b.bootstrap(allStoreprojectNodeDirs());
    await LLMRegistry.getInstance().initialize();

    const memNode = await b.spawnNode({ type: "memory", name: "memory" });
    const memDataDir = path.join(getNodeDataRoot(), memNode.id);
    spawnedDataDirs.push(memDataDir);
    memPath = path.join(memDataDir, "memory.json");
    await b.spawnNode({
      type: "memory-proxy", name: "memory-proxy",
      config_overrides: { model: TEST_MODEL, response_topic: "mem.response" },
    });
    await b.spawnNode({
      type: "terminal", name: "shell",
      subscriptions: [{ topic: "cmd.exec" }],
      config_overrides: {
        response_topic: "cmd.output", timeout_ms: 10000,
        allowed_commands: ["echo", "date", "whoami"],
      },
    });
    await b.spawnNode({
      type: "brain", name: "consciousness",
      subscriptions: [
        { topic: "chat.input" }, { topic: "alerts.*" },
        { topic: "mem.response" }, { topic: "memory.result" },
        { topic: "cmd.output" },
      ],
      config_overrides: {
        model: TEST_MODEL, response_topic: "chat.response",
        max_steps: 12, max_iterations: 10, handler_timeout_ms: 120000,
      },
    });

    await delay(3000);
    return b;
  }

  it("runs a command and stores the result in memory", async () => {
    const token = crypto.randomBytes(6).toString("hex").toUpperCase();
    let found = false;

    for (let i = 0; i < MAX_ATTEMPTS && !found; i++) {
      if (brain) { brain.killAll(); brain = null; }
      brain = await freshSetup();

      brain.bus.publish({
        from: "e2e-test", topic: "chat.input", type: "text", criticality: 5,
        payload: {
          content: [
            `Do two things in order:`,
            `1. Run this shell command using publish_message on topic "cmd.exec": echo "${token}"`,
            `2. After you get the result, store it in memory using publish_message on topic "mem.store" with content: {"key":"cmd_result","value":"${token}","tags":["test"]}`,
            `Tell me when both are done.`,
          ].join("\n"),
        },
      });

      // Wait for the token to appear in the memory node's store
      const deadline = Date.now() + TIMEOUT;
      while (Date.now() < deadline && !found) {
        await delay(3000);
        const mem = fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf-8") : "";
        if (mem.includes(token)) found = true;
      }

      if (!found) {
        const brainNode = brain.getNetworkSnapshot({ state: "all" }).find((n) => n.type === "brain");
        const logs = brainNode ? brain.getNodeLogs(brainNode.id, 20) : [];
        const msgs = brain.bus.getMessageHistory({ last: 10 });
        console.log(`\n  Multi-service attempt ${i + 1}/${MAX_ATTEMPTS} FAILED`);
        console.log("  Brain logs:");
        for (const l of logs) console.log(`    [${l.level}] ${l.message.slice(0, 120)}`);
        console.log("  Bus:");
        for (const m of msgs) console.log(`    ${m.topic}: ${(m.payload as { content?: string }).content?.slice(0, 80)}`);
        console.log("  Memory:", fs.existsSync(memPath) ? fs.readFileSync(memPath, "utf-8").slice(0, 200) : "empty");
      }
    }

    expect(found, `Token "${token}" not found in memory.json after multi-service chain`).toBe(true);
  }, (TIMEOUT + 10_000) * MAX_ATTEMPTS);
});
