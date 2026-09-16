import OpenAI from "openai";
import { assertCompleteResponse } from "../src/server/response-status";

export async function probe(client: OpenAI, model: string, signal: AbortSignal) {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: "user", content: "Call get_test_context to look up the device. Do not guess. Then tell me the device name returned by the tool." }];
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [{ type: "function", function: {
    name: "get_test_context", description: "Look up the fictional device for this connection test.",
    parameters: { type: "object", properties: {}, additionalProperties: false }
  } }];
  const first = await client.chat.completions.create({ model, messages, tools, tool_choice: "auto", max_tokens: 2048 }, { signal });
  assertCompleteResponse(first);
  const assistant = first.choices[0]?.message;
  if (!assistant?.tool_calls?.length) throw new Error("No structured tool request. Select a tool-capable model and run the probe again.");
  messages.push(assistant);
  for (const call of assistant.tool_calls) {
    if (call.type !== "function" || call.function.name !== "get_test_context" || !call.id) throw new Error("The model returned an unexpected tool request.");
    const args: unknown = JSON.parse(call.function.arguments);
    if (!args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).length) throw new Error("The model returned invalid tool arguments.");
    messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify({ device: "Fictional iPhone 15" }) });
  }
  const second = await client.chat.completions.create({ model, messages, max_tokens: 2048 }, { signal });
  assertCompleteResponse(second);
  const answer = second.choices[0]?.message;
  if (answer?.tool_calls?.length || !answer?.content || !/iPhone 15/i.test(answer.content)) throw new Error("No final answer grounded in the tool result. Try another tool-capable model.");
}

export async function probeJson(client: OpenAI, model: string, signal: AbortSignal) {
  const result = await client.chat.completions.create({ model, max_tokens: 2048, response_format: { type: "json_object" },
    messages: [{ role: "user", content: 'Return only this JSON object: {"ok":true}' }] }, { signal });
  assertCompleteResponse(result);
  const raw = result.choices[0]?.message?.content;
  if (!raw || JSON.parse(raw).ok !== true) throw new Error("Optional JSON response check failed. This is separate from the tracing exercise.");
}
