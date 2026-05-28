import type { ChatMessage } from "../types/chatMessage";

/** 粗略的 token 数估算。接入时替换为 tiktoken 或对应模型的 tokenizer。 */
export function estimateTokens(text: string): number {
  // 中文约每 3 字符 1 token，英文约每 4 字符 1 token
  return Math.ceil(text.length / 3);
}

export function estimateMessageTokens(msg: ChatMessage): number {
  const content = "content" in msg ? (msg as any).content ?? "" : "";
  const toolCalls = "tool_calls" in msg ? JSON.stringify((msg as any).tool_calls) : "";
  return estimateTokens(content + toolCalls);
}
