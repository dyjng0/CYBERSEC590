import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type Message = { role: string; content?: string | null; tool_call_id?: string };
type Call = { body: { messages: Message[] }; signal: AbortSignal };
type Reply = unknown | ((call: Call) => Promise<unknown>);
type Result = { answer: string; usedTools: string[] };

const serverDirectory = fileURLToPath(new URL("../src/server/", import.meta.url));
const request = { sessionId: "offline-test", messages: [{ id: "one", role: "user", content: "Help with Bluetooth", timestamp: "2026-01-01T00:00:00Z" }] };
const answer = (finishReason = "stop") => ({ choices: [{ finish_reason: finishReason, message: { role: "assistant", content: "Here is the answer." } }] });
const tool = (argumentsText = "{}", name = "get_support_context") => ({ choices: [{ finish_reason: "tool_calls", message: {
  role: "assistant", content: null,
  tool_calls: [{ id: "call_1", type: "function", function: { name, arguments: argumentsText } }]
} }] });

// Execute the actual agent, tool dispatch, data, and response-validation source.
// Only the network client, environment, and tracing wrappers are replaced.
// This checks application behavior; it does not claim to test trace delivery.
function harness(replies: Reply[], timeoutMs = 1000) {
  const calls: Call[] = [];
  const dispatched: string[] = [];
  const clientOptions: Record<string, unknown>[] = [];
  const shutdownController = new AbortController();
  class FakeOpenAI {
    constructor(options: Record<string, unknown>) { clientOptions.push(options); }
    chat = { completions: { create: async (body: Call["body"], options: { signal: AbortSignal }) => {
      const call = { body: structuredClone(body), signal: options.signal };
      calls.push(call);
      assert.ok(calls.length <= replies.length, "Unexpected extra model request");
      const reply = replies[calls.length - 1];
      return typeof reply === "function" ? reply(call) : reply;
    } } };
  }
  const stubs: Record<string, unknown> = {
    openai: FakeOpenAI,
    "@langfuse/openai": { observeOpenAI: (client: unknown) => client },
    "@langfuse/tracing": { observe: (fn: unknown) => fn },
    "./env": {
      env: { openaiApiKey: "test-key", openaiBaseUrl: "https://example.invalid/v1", openaiModel: "test", chatTimeoutMs: timeoutMs },
      provider: { label: "Offline test", credentialsPresent: true, keyName: "TEST_KEY" }
    },
    "./lifecycle": { shutdownController }
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  function load(filename: string): Record<string, unknown> {
    const cached = cache.get(filename);
    if (cached) return cached.exports;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(filename, module);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      fileName: filename
    }).outputText;
    const localRequire = (name: string): unknown => {
      if (Object.hasOwn(stubs, name)) return stubs[name];
      assert.ok(name.startsWith("."), `Unexpected external dependency: ${name}`);
      const imported = load(path.resolve(path.dirname(filename), name + ".ts"));
      if (name === "./tools") {
        return { ...imported, executeTool: async (toolName: string, input: Record<string, unknown>) => {
          dispatched.push(toolName);
          return (imported.executeTool as (name: string, input: Record<string, unknown>) => Promise<unknown>)(toolName, input);
        } };
      }
      return imported;
    };
    runInNewContext(compiled, { module, exports: module.exports, require: localRequire, AbortSignal, AbortController, console }, { filename });
    return module.exports;
  }
  const agent = load(path.join(serverDirectory, "support-agent.ts"));
  return {
    run: () => (agent.runSupportConversation as (input: unknown) => Promise<Result>)(request),
    calls, dispatched, clientOptions, shutdownController
  };
}

for (const argumentsText of ["not-json", "null", "42", '"text"', "[]"]) {
  test(`agent does not execute or count invalid arguments: ${argumentsText}`, async () => {
    const h = harness([tool(argumentsText), answer()]);
    const result = await h.run();
    assert.deepEqual(h.dispatched, []);
    assert.deepEqual([...result.usedTools], []);
    const feedback = h.calls[1].body.messages.at(-1);
    assert.equal(feedback?.role, "tool");
    assert.equal(JSON.parse(feedback?.content ?? "").ok, false);
  });
}

test("agent returns unsupported-tool feedback without counting a successful tool", async () => {
  const h = harness([tool("{}", "unknown_tool"), answer()]);
  const result = await h.run();
  assert.deepEqual([...result.usedTools], []);
  const feedback = JSON.parse(h.calls[1].body.messages.at(-1)?.content ?? "");
  assert.equal(feedback.ok, false);
  assert.match(feedback.error, /Unsupported tool/);
});

test("agent counts a real successful dispatch and sends its result to the next model call", async () => {
  const h = harness([tool(), answer()]);
  const result = await h.run();
  assert.deepEqual(h.dispatched, ["get_support_context"]);
  assert.deepEqual([...result.usedTools], ["get_support_context"]);
  const feedback = h.calls[1].body.messages.at(-1);
  assert.equal(feedback?.tool_call_id, "call_1");
  assert.equal(JSON.parse(feedback?.content ?? "").ok, true);
  assert.equal(result.answer, "Here is the answer.");
  assert.equal(h.calls[0].signal, h.calls[1].signal, "One deadline must cover the whole turn");
  assert.equal(h.clientOptions[0].maxRetries, 0);
  assert.equal(h.clientOptions[0].timeout, 1000);
});

for (const finishReason of ["length", "content_filter"]) {
  test(`agent rejects an unfinished or filtered completion: ${finishReason}`, async () => {
    const h = harness([answer(finishReason)]);
    await assert.rejects(h.run());
    assert.equal(h.calls.length, 1);
  });
}

test("agent rejects six consecutive tool steps without a final answer", async () => {
  const h = harness(Array.from({ length: 6 }, () => tool()));
  await assert.rejects(h.run(), /six steps/);
  assert.equal(h.calls.length, 6);
});

test("shutdown aborts the signal supplied to an active model request", async () => {
  const h = harness([(call: Call) => new Promise((_resolve, reject) => {
    call.signal.addEventListener("abort", () => reject(new Error("test request aborted")), { once: true });
    h.shutdownController.abort();
  })]);
  await assert.rejects(h.run(), /test request aborted/);
  assert.equal(h.calls[0].signal.aborted, true);
});
