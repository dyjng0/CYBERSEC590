import { test } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { resolveProvider, requireProviderKey } from "../src/server/provider-config";
import { userFacingError } from "../src/server/errors";
import { probe, probeJson } from "../scripts/probe";

const config = { OLLAMA_API_KEY: "test-ollama-token", DUKE_API_KEY: "test-duke-token", OLLAMA_MODEL: "gemma4:31b", DUKE_MODEL: "gpt-4.1-mini" };
const toolMessage = { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_test_context", arguments: "{}" } }] };

function mockClient(messages: unknown[], inspect?: (request: Request, body: Record<string, unknown>) => void) {
  let count = 0;
  const client = new OpenAI({ apiKey: "test-key", baseURL: "https://example.invalid/v1", maxRetries: 0,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const body = await request.json() as Record<string, unknown>;
      inspect?.(request, body);
      return Response.json({ id: "test", object: "chat.completion", created: 0, model: "test", choices: [{ index: 0, message: messages[count++], finish_reason: "stop" }] });
    }
  });
  return { client, count: () => count };
}

test("defaults to Ollama and rejects invalid provider or blank model", () => {
  assert.equal(resolveProvider({}).provider, "ollama");
  assert.throws(() => resolveProvider({ MODEL_PROVIDER: "typo" }), /must be ollama or duke/);
  assert.throws(() => resolveProvider({ OLLAMA_MODEL: " " }), /exact model ID/);
});

test("requires the selected key and never falls back to the other provider", () => {
  for (const dummy of ["", "ollama", "your-key", "example-key", "..."]) {
    assert.throws(() => requireProviderKey(resolveProvider({ ...config, MODEL_PROVIDER: "ollama", OLLAMA_API_KEY: dummy })), /OLLAMA_API_KEY/);
  }
  assert.throws(() => requireProviderKey(resolveProvider({ ...config, MODEL_PROVIDER: "duke", DUKE_API_KEY: "" })), /DUKE_API_KEY/);
});

for (const selected of ["ollama", "duke"] as const) {
  test(`${selected}: correct endpoint, key, model, and two-step tool exchange`, async () => {
    const provider = resolveProvider({ ...config, MODEL_PROVIDER: selected });
    const expectedBase = selected === "ollama" ? "https://ollama.com/v1" : "https://litellm.oit.duke.edu/v1";
    const expectedKey = selected === "ollama" ? config.OLLAMA_API_KEY : config.DUKE_API_KEY;
    const expectedModel = selected === "ollama" ? config.OLLAMA_MODEL : config.DUKE_MODEL;
    let calls = 0;
    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, maxRetries: 0,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        assert.equal(request.url, `${expectedBase}/chat/completions`);
        assert.equal(request.headers.get("authorization"), `Bearer ${expectedKey}`);
        const body = await request.json() as { model: string; max_tokens: number; messages: { role: string; content: string; tool_call_id?: string }[]; response_format?: unknown };
        assert.equal(body.model, expectedModel);
        assert.equal(body.max_tokens, 2048);
        assert.equal(body.response_format, undefined);
        if (calls === 1) {
          assert.equal(body.messages.at(-1)?.tool_call_id, "call_1");
          assert.match(body.messages.at(-1)?.content ?? "", /Fictional iPhone 15/);
        }
        return Response.json({ choices: [{ message: calls++ === 0 ? toolMessage : { role: "assistant", content: "Your device is Fictional iPhone 15." } }] });
      }
    });
    await probe(client, provider.model, AbortSignal.timeout(1000));
    assert.equal(calls, 2);
  });
}

test("probe rejects plain text pretending to be a tool call", async () => {
  const { client, count } = mockClient([{ role: "assistant", content: "get_test_context()" }]);
  await assert.rejects(probe(client, "test", AbortSignal.timeout(1000)), /No structured tool request/);
  assert.equal(count(), 1);
});

test("probe rejects malformed tool arguments", async () => {
  const message = structuredClone(toolMessage);
  message.tool_calls[0].function.arguments = "[]";
  const { client } = mockClient([message]);
  await assert.rejects(probe(client, "test", AbortSignal.timeout(1000)), /invalid tool arguments/);
});

test("probe rejects an answer that ignores the tool result", async () => {
  const { client } = mockClient([toolMessage, { role: "assistant", content: "I don't know." }]);
  await assert.rejects(probe(client, "test", AbortSignal.timeout(1000)), /No final answer grounded/);
});

test("optional JSON check fails independently on Markdown-wrapped JSON", async () => {
  const { client } = mockClient([{ role: "assistant", content: '```json\n{"ok":true}\n```' }], (_request, body) => {
    assert.deepEqual(body.response_format, { type: "json_object" });
  });
  await assert.rejects(probeJson(client, "test", AbortSignal.timeout(1000)), SyntaxError);
});

test("upstream auth and quota errors do not expose raw provider messages", () => {
  for (const status of [401, 403, 429, 500]) {
    assert.doesNotMatch(userFacingError({ status, message: "private-token-or-payload" }), /private-token/);
  }
  assert.match(userFacingError({ name: "APIUserAbortError" }), /timed out or the app restarted/);
});

for (const reason of ["length", "content_filter"]) {
  test(`probe rejects ${reason} even when partial text contains the expected device`, async () => {
    let count = 0;
    const client = new OpenAI({ apiKey: "test-key", baseURL: "https://example.invalid/v1", maxRetries: 0,
      fetch: async () => Response.json({ choices: [{
        message: count === 0 ? toolMessage : { role: "assistant", content: "Fictional iPhone 15, and then" },
        finish_reason: count++ === 0 ? "tool_calls" : reason
      }] })
    });
    await assert.rejects(probe(client, "test", AbortSignal.timeout(1000)), /cut short|content filter/);
  });
}
