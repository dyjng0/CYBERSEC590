import OpenAI from "openai";
import { assertCompleteResponse } from "./response-status";
import { shutdownController } from "./lifecycle";
import type { ChatMessage, ChatRequest, ChatResponse } from "../shared/types";
import { env, provider } from "./env";
import { requireProviderKey } from "./provider-config";
import { getSupportContext } from "./support-data";
import { TOOL_DEFINITIONS, executeTool } from "./tools";
import { observeOpenAI } from "@langfuse/openai";
import { observe } from "@langfuse/tracing";

export const SYSTEM_PROMPT = `You are Dad IT Support Agent.
You are talking directly to Dad. He opened this chat himself to get help with his iPhone.

You do not yet know which iPhone Dad has or which apps he uses — call get_support_context to find out before giving any device-specific instructions.

Rules:
- Speak directly to Dad in second person ("you", "your iPhone"). Never refer to Dad in the third person.
- Call get_support_context as your very first tool call on each turn so you know which iPhone, iOS, and apps Dad has.
- For step-by-step help, call search_help_library before giving the final answer.
- Use short numbered steps with one action per line.
- Mention what Dad should expect to see on his screen after important taps.
- Be honest about limits. You cannot see his screen, passwords, or real-time location.
- If the request is out of scope, say so kindly and redirect to the closest iPhone-help you can give.
- Do not invent button names or settings paths that were not confirmed by tool results.
`;

function toOpenAIMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

function readAssistantText(
  message: OpenAI.Chat.Completions.ChatCompletionMessage,
) {
  if (typeof message.content === "string") {
    return message.content.trim();
  }
  return "";
}

function parseToolArguments(argumentsText: string) {
  try {
    const parsed = JSON.parse(argumentsText);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

async function runSupportConversationInner(
  request: ChatRequest,
): Promise<ChatResponse> {
  const context = getSupportContext();
  requireProviderKey(provider);
  const signal = AbortSignal.any([
    AbortSignal.timeout(env.chatTimeoutMs),
    shutdownController.signal,
  ]);
  const openai = observeOpenAI(
    new OpenAI({
      apiKey: env.openaiApiKey,
      baseURL: env.openaiBaseUrl,
      timeout: env.chatTimeoutMs,
      maxRetries: 0,
    }),
  );
  const transcript: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toOpenAIMessages(request.messages),
  ];
  const usedTools = new Set<string>();
  let finalAnswer = "";

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await openai.chat.completions.create(
      {
        model: env.openaiModel,
        messages: transcript,
        tools: TOOL_DEFINITIONS,
        tool_choice: "auto",
        max_tokens: 2048,
      },
      { signal },
    );

    assertCompleteResponse(response);
    const message = response.choices[0]?.message;
    if (!message) {
      throw new Error(`${provider.label} returned no assistant message.`);
    }
    transcript.push(
      message as OpenAI.Chat.Completions.ChatCompletionMessageParam,
    );

    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      finalAnswer = readAssistantText(message);
      break;
    }

    for (const toolCall of toolCalls) {
      if (toolCall.type !== "function") continue;
      const parsedArguments = parseToolArguments(toolCall.function.arguments);
      const result =
        parsedArguments === null
          ? {
              ok: false,
              error: `The tool arguments for ${toolCall.function.name} must be a valid JSON object.`,
            }
          : await executeTool(toolCall.function.name, parsedArguments);
      if (result.ok === true) usedTools.add(toolCall.function.name);
      transcript.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  if (!finalAnswer) {
    throw new Error(
      "The model did not finish an answer within six steps. Try a shorter question or another tool-capable model.",
    );
  }

  return {
    answer: finalAnswer,
    usedTools: [...usedTools],
    traceMeta: {
      contextId: context.id,
      contextLabel: context.label,
      model: env.openaiModel,
      provider: provider.label,
    },
  };
}

export const runSupportConversation = observe(runSupportConversationInner, {
  name: "dad-it-support-chat-turn",
  asType: "agent",
});
