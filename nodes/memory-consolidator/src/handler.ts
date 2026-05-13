import type { NodeHandler, TextPayload } from "@brain/sdk";

/**
 * Memory Consolidator — autonomous LLM agent for memory maintenance.
 *
 * Tagged "llm" → runs in LLMRunner with budget loop.
 * Wakes periodically (timer) or when memory.result arrives.
 * Uses ctx.state to persist progress across budget cycles.
 *
 * Wake prompt changes based on context:
 *   - Timer wake (idle): "review and consolidate memories"
 *   - Message wake: "process the result of your last action"
 */

const SYSTEM_PROMPT = `You are the memory consolidator of the brAIn network.
Your job is to keep the memory store clean, organized, and useful.

## Your responsibilities
- Remove duplicate or redundant entries (merge them into one)
- Remove stale or meaningless entries (test data, empty values)
- Consolidate related facts into single well-written entries
- Improve key names to be clear and descriptive
- Add missing tags for better searchability
- Keep entries concise but complete

## Rules
- Do ONE action at a time, then wait for the result before deciding next.
- Be conservative — don't delete useful information.
- Prefer updating over deleting when information can be improved.
- Use your full budget: keep working as long as there are things to improve.
- Use the framework-provided \`stop\` tool when you have reviewed everything and there is genuinely nothing left to do.
- If contradictory entries exist, keep the most recent one and delete the older.
- If duplicate entries exist, merge them into one with the best key name.

You MUST act through one of the provided tools — no free text.`;

const ACTION_TOOLS = {
  list: {
    description: "List every memory entry. Use this to survey what's stored before consolidating.",
    inputSchema: {
      type: "object", additionalProperties: false, properties: {},
    },
  },
  search: {
    description: "Search the memory store for entries matching the given keywords.",
    inputSchema: {
      type: "object", required: ["query"], additionalProperties: false,
      properties: {
        query: { type: "string", description: "Search keywords." },
      },
    },
  },
  delete: {
    description: "Delete a memory entry by its key. Only use after confirming the entry is stale, duplicate, or meaningless.",
    inputSchema: {
      type: "object", required: ["key"], additionalProperties: false,
      properties: {
        key: { type: "string", description: "The exact key of the entry to delete." },
      },
    },
  },
  update: {
    description: "Replace the value of an existing memory entry. Prefer this over delete when the information can be improved or merged.",
    inputSchema: {
      type: "object", required: ["key", "value"], additionalProperties: false,
      properties: {
        key: { type: "string", description: "The exact key of the entry to update." },
        value: { type: "string", description: "The new value (full replacement)." },
      },
    },
  },
  store: {
    description: "Store a new memory entry. Use this when consolidating multiple entries into one new well-named entry.",
    inputSchema: {
      type: "object", required: ["key", "value"], additionalProperties: false,
      properties: {
        key: { type: "string", description: "Clear, descriptive key for the new entry." },
        value: { type: "string", description: "The value of the entry." },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags improving searchability.",
        },
      },
    },
  },
} as const;

// Minimum interval between idle consolidation runs (ms).
const RUN_INTERVAL_MS = 60 * 60 * 1000; // 1h

export const handler: NodeHandler = async (ctx) => {
  // Determine wake context
  const wokeFromSleep = ctx.state._woke_from_sleep as boolean | undefined;
  const hasMessages = ctx.messages.length > 0;
  const pendingAction = ctx.state._pending_action as string | undefined;

  // Gate periodic ticks: most time.tick messages are no-ops. We only run if a
  // pending action result is in, a non-tick message arrived, or RUN_INTERVAL_MS
  // has elapsed since the last run.
  const tickMessages = ctx.messages.filter((m) => m.topic === "time.tick");
  const nonTickMessages = ctx.messages.filter((m) => m.topic !== "time.tick");
  const lastRunAt = (ctx.state._last_run_at as number | undefined) ?? 0;
  const now = Date.now();
  const intervalElapsed = now - lastRunAt >= RUN_INTERVAL_MS;
  const hasWorkSignal = nonTickMessages.length > 0 || pendingAction !== undefined;

  if (tickMessages.length > 0 && !hasWorkSignal && !intervalElapsed) {
    // Idle tick: nothing to do, just park.
    return;
  }
  ctx.state._last_run_at = now;

  // Build conversation from state (persists across budget cycles)
  if (!ctx.state._conversation) ctx.state._conversation = [];
  const conversation = ctx.state._conversation as Array<{ role: "user" | "assistant"; content: string }>;

  // === Process results from previous actions ===
  if (hasMessages && pendingAction) {
    const results = ctx.messages
      .filter((m) => m.topic === "memory.result")
      .map((m) => (m.payload as TextPayload).content);

    if (results.length > 0) {
      conversation.push({
        role: "user",
        content: `Result of your "${pendingAction}" action:\n${results.join("\n")}`,
      });
      ctx.state._pending_action = undefined;
    }
  }

  // === Wake prompt — tells the agent what to do ===
  if (conversation.length === 0 || (wokeFromSleep && !pendingAction)) {
    const progress = ctx.state._progress as string | undefined;
    const wakeMessage = progress
      ? `You were previously working on: ${progress}\nContinue where you left off, or start fresh if done.`
      : "You just woke up. Start by listing all memories to see what needs attention.";

    const now = new Date().toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "medium" });
    const hint = ctx.state._system_hint as string | undefined ?? "";

    conversation.push({
      role: "user",
      content: `${wakeMessage}\n\nCurrent time: ${now}\n${hint}`,
    });
  }

  // Keep conversation short
  while (conversation.length > 20) conversation.shift();

  // === LLM call — multi-tool dispatch ===
  // Every consolidator decision goes through a typed tool: ai-sdk
  // validates args against the schema, no JSON extraction, no parsing
  // fallback. The framework-injected `stop` tool replaces the old
  // {"action":"sleep"} pattern.
  try {
    const picked = await ctx.llm.tools({
      tools: ACTION_TOOLS,
      system: SYSTEM_PROMPT,
      prompt: conversation,
    });
    ctx.log("info", `Action tool: ${picked.toolName}`);
    conversation.push({
      role: "assistant",
      content: JSON.stringify({ tool: picked.toolName, args: picked.args }),
    });

    if (picked.toolName === "stop") {
      ctx.log("info", "Done consolidating");
      if (ctx.state._made_changes) {
        ctx.log("info", "Triggering vector reindex");
        ctx.publish("memory-vector.reindex", { type: "text", criticality: 1, payload: { content: "{}" } });
        ctx.state._made_changes = false;
      }
      ctx.state._progress = undefined;
      ctx.state._conversation = [];
      return;
    }

    const args = picked.args as { key?: string; value?: string; query?: string; tags?: string[] };
    switch (picked.toolName) {
      case "list":
        ctx.publish("memory.list", { type: "text", criticality: 1, payload: { content: "{}" } });
        ctx.state._pending_action = "list";
        ctx.state._progress = "listing memories";
        break;

      case "search":
        ctx.publish("memory.search", {
          type: "text", criticality: 1,
          payload: { content: JSON.stringify({ query: args.query }) },
        });
        ctx.state._pending_action = "search";
        ctx.state._progress = `searching for "${args.query}"`;
        break;

      case "delete":
        ctx.publish("memory.delete", { type: "text", criticality: 1, payload: { content: JSON.stringify({ key: args.key }) } });
        ctx.state._pending_action = "delete";
        ctx.state._progress = `deleted "${args.key}"`;
        ctx.state._made_changes = true;
        ctx.respond(`Deleted memory: ${args.key}`, { action: "delete" });
        break;

      case "update":
        ctx.publish("memory.update", { type: "text", criticality: 1, payload: { content: JSON.stringify({ key: args.key, value: args.value }) } });
        ctx.state._pending_action = "update";
        ctx.state._progress = `updated "${args.key}"`;
        ctx.state._made_changes = true;
        ctx.respond(`Updated memory: ${args.key}`, { action: "update" });
        break;

      case "store":
        ctx.publish("memory.store", { type: "text", criticality: 1, payload: { content: JSON.stringify({ key: args.key, value: args.value, tags: args.tags ?? [] }) } });
        ctx.state._pending_action = "store";
        ctx.state._progress = `stored "${args.key}"`;
        ctx.state._made_changes = true;
        ctx.respond(`Stored memory: ${args.key}`, { action: "store" });
        break;
    }
    // After an action that expects a result, just return — the framework parks
    // us until memory.result (or the next tick) wakes us back up.

  } catch (err) {
    ctx.log("error", `Consolidation error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
