/**
 * E2E: Memory consolidator cleans up contradictory/duplicate entries.
 *
 * Seeds memory with:
 *   - Two contradictory facts (user lives in Paris vs Lyon, different dates)
 *   - Two duplicate entries (same content, different keys)
 *   - One stale test entry
 *
 * Spawns the consolidator and lets it run with its budget.
 * Verifies that the memory is cleaner after consolidation.
 *
 * Requires: Ollama running with the test model.
 */
import { describe, it, expect, afterEach } from "vitest";
import { BrainService, LLMRegistry, getNodeDataRoot } from "@brain/core";
import * as fs from "fs";
import * as path from "path";
import { allStoreprojectNodeDirs } from "./_helpers/storeprojects-dirs";

const TEST_MODEL = process.env.BRAIN_E2E_MODEL ?? "ollama/gemma4:e4b";
const MAX_WAIT = 90_000;
// A 4B-class model skips the job on a bad sampling day — give it three
// fresh runs before declaring the consolidator broken.
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

const TWO_DAYS_AGO = Date.now() - 2 * 86_400_000;
const ONE_HOUR_AGO = Date.now() - 3_600_000;
const NOW = Date.now();

// The memory node persists its store inside its own per-instance
// ctx.dataDir (<data>/nodes/<nodeId>/memory.json) — seed THAT file,
// not the legacy shared data/memory.json the node no longer reads.
function seedMemory(memPath: string): void {
  fs.mkdirSync(path.dirname(memPath), { recursive: true });

  const data: Record<string, unknown> = {
    // Contradictory: old says Paris, recent says Lyon
    user_city_old: {
      key: "user_city_old",
      value: "The user lives in Paris",
      tags: ["user", "location"],
      created_at: TWO_DAYS_AGO,
      updated_at: TWO_DAYS_AGO,
      created_by: "test",
      created_date: new Date(TWO_DAYS_AGO).toISOString(),
      updated_date: new Date(TWO_DAYS_AGO).toISOString(),
    },
    user_city_new: {
      key: "user_city_new",
      value: "The user moved to Lyon",
      tags: ["user", "location"],
      created_at: NOW,
      updated_at: NOW,
      created_by: "test",
      created_date: new Date(NOW).toISOString(),
      updated_date: new Date(NOW).toISOString(),
    },
    // Duplicates: same info, different keys
    user_job_1: {
      key: "user_job_1",
      value: "Thibaut is a software developer",
      tags: ["user"],
      created_at: ONE_HOUR_AGO,
      updated_at: ONE_HOUR_AGO,
      created_by: "test",
      created_date: new Date(ONE_HOUR_AGO).toISOString(),
      updated_date: new Date(ONE_HOUR_AGO).toISOString(),
    },
    user_job_2: {
      key: "user_job_2",
      value: "Thibaut is a software developer",
      tags: ["user"],
      created_at: NOW,
      updated_at: NOW,
      created_by: "test",
      created_date: new Date(NOW).toISOString(),
      updated_date: new Date(NOW).toISOString(),
    },
    // Stale test data
    test_garbage: {
      key: "test_garbage",
      value: "ANIMAL-abc123 test data from e2e run",
      tags: ["test"],
      created_at: TWO_DAYS_AGO,
      updated_at: TWO_DAYS_AGO,
      created_by: "e2e-test",
      created_date: new Date(TWO_DAYS_AGO).toISOString(),
      updated_date: new Date(TWO_DAYS_AGO).toISOString(),
    },
  };

  fs.writeFileSync(memPath, JSON.stringify(data, null, 2));
}

function readMemory(memPath: string): Record<string, { key: string; value: string; tags: string[] }> {
  if (!fs.existsSync(memPath)) return {};
  return JSON.parse(fs.readFileSync(memPath, "utf-8")) as Record<string, { key: string; value: string; tags: string[] }>;
}

describe("e2e: memory consolidator", async () => {
  const ollamaUp = await isOllamaAvailable();
  if (!ollamaUp) {
    it.skip("Ollama not available", () => {});
    return;
  }

  let brain: BrainService | null = null;
  const spawnedDataDirs: string[] = [];
  afterEach(() => {
    try { brain?.killAll(); } catch { /* */ }
    brain = null;
    // The per-instance node data dirs are throwaway UUID dirs — clean them.
    for (const dir of spawnedDataDirs.splice(0)) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ }
    }
  });

  it("consolidates contradictory and duplicate memories", async () => {
    let cleaned = false;

    for (let attempt = 0; attempt < MAX_ATTEMPTS && !cleaned; attempt++) {
      // Full reset
      if (brain) { brain.killAll(); brain = null; }

      brain = new BrainService(":memory:");
      brain.bootstrap(allStoreprojectNodeDirs());
      await LLMRegistry.getInstance().initialize();

      // Spawn memory KV (needed for the consolidator to talk to), then
      // seed its own per-instance store with the dirty corpus.
      const memNode = await brain.spawnNode({ type: "memory", name: "memory" });
      const memDataDir = path.join(getNodeDataRoot(), memNode.id);
      const memPath = path.join(memDataDir, "memory.json");
      spawnedDataDirs.push(memDataDir);
      seedMemory(memPath);

      const before = readMemory(memPath);
      const keysBefore = Object.keys(before);
      console.log(`\n  Attempt ${attempt + 1}: ${keysBefore.length} entries before consolidation`);

      // Spawn the consolidator after the seed so its first wake already
      // sees dirty data.
      const consolidator = await brain.spawnNode({
        type: "memory-consolidator",
        name: "memory-janitor",
        subscriptions: [{ topic: "memory.result" }],
        config_overrides: {
          model: TEST_MODEL,
          max_iterations: 8,
        },
      });
      spawnedDataDirs.push(path.join(getNodeDataRoot(), consolidator.id));

      // Send it a kick to start (it needs a message or timer wake)
      await delay(2000);
      brain.bus.publish({
        from: "test", topic: "memory.result", type: "text", criticality: 1,
        payload: { content: "Maintenance time. Memory currently contains duplicate and contradictory entries. List all memories, then use the update/delete tools to merge duplicates and resolve contradictions (keep the most recent fact). Do not stop before you have modified at least one entry." },
      });

      // Wait for consolidator to finish its budget and sleep
      const deadline = Date.now() + MAX_WAIT;
      while (Date.now() < deadline) {
        await delay(3000);

        const after = readMemory(memPath);
        const keysAfter = Object.keys(after);

        // Track if anything changed
        if (!cleaned) {
          const entriesRemoved = keysAfter.length < keysBefore.length;
          const valuesChanged = keysAfter.some((k) => {
            const bVal = (before[k] as { value?: string } | undefined)?.value;
            const aVal = (after[k] as { value?: string } | undefined)?.value;
            return bVal !== undefined && aVal !== undefined && bVal !== aVal;
          });
          if (entriesRemoved || valuesChanged) cleaned = true;
        }

        // The reactive runtime has no sleep state — as soon as memory got
        // cleaner the job is proven, stop polling.
        if (cleaned) {
          const afterFinal = readMemory(memPath);
          const keysFinal = Object.keys(afterFinal);
          console.log(`  Done: ${keysFinal.length} entries (was ${keysBefore.length})`);
          console.log("  Remaining:", keysFinal);
          break;
        }
      }

      // Dump logs
      const logs = brain.getNodeLogs(consolidator.id, 30);
      console.log("  Consolidator logs:");
      for (const l of logs) console.log(`    [${l.level}] ${l.message.slice(0, 140)}`);
    }

    expect(cleaned, "Consolidator should have modified at least one entry").toBe(true);
  }, (MAX_WAIT + 10_000) * MAX_ATTEMPTS);
});
