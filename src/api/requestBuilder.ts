import type { ChatMessage } from "../types/chatMessage";

/**
 * 将内部 ChatMessage[] 转为 DeepSeek / OpenAI 兼容的 messages 格式。
 *
 * ChatMessage（内部）→ OpenAI Message Dict：
 *   SystemMessage    → { role: "system", content }
 *   UserMessage      → { role: "user", content }
 *   AssistantMessage → { role: "assistant", content, tool_calls? }
 *   ToolMessage      → { role: "tool", tool_call_id, content }
 */
function toOpenAIMessages(messages: ChatMessage[]): Record<string, unknown>[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case "system":
        return { role: "system", content: msg.content };
      case "user":
        return { role: "user", content: msg.content };
      case "assistant":
        return {
          role: "assistant",
          content: msg.content ?? null,
          ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
        };
      case "tool":
        return {
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: msg.content,
        };
    }
  });
}

/**
 * 构造 DeepSeek API 请求体。
 * 完全兼容 OpenAI Chat Completions API 格式。
 */
export function buildDeepSeekRequest(params: {
  messages: ChatMessage[];
  model?: string;
  stream?: boolean;
  tools?: Record<string, unknown>[];
  temperature?: number;
  max_tokens?: number;
}): Record<string, unknown> {
  const {
    messages,
    model = "deepseek-chat",
    stream = true,
    tools,
    temperature = 0.7,
    max_tokens = 4096,
  } = params;

  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(messages),
    stream,
    temperature,
    max_tokens,
  };

  if (tools?.length) {
    body.tools = tools;
  }

  return body;
}
