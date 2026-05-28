import { buildDeepSeekRequest } from "./requestBuilder";
import { DEEPSEEK_ENDPOINTS } from "../config/api";
import type { ChatMessage } from "../types/chatMessage";

/**
 * DeepSeek API 流式请求客户端。
 *
 * 返回 ReadableStream<Uint8Array>（SSE 格式），可直接传入 useStreamResponse.start()。
 * API Key 由 Vite proxy 在服务端注入，前端不持有。
 *
 * @throws {Error} 非 2xx 响应时抛出，message 包含 HTTP 状态码和响应体
 *
 * 使用示例：
 *   const stream = await streamDeepSeekChat({
 *     messages: toModelMessages(window),
 *     model: "deepseek-chat",
 *   });
 *   streamResult.start({ type: "stream", stream });
 */
export async function streamDeepSeekChat(params: {
  messages: ChatMessage[];
  model?: string;
  tools?: Record<string, unknown>[];
  temperature?: number;
}): Promise<ReadableStream<Uint8Array>> {
  const body = buildDeepSeekRequest({ ...params, stream: true });

  const response = await fetch(DEEPSEEK_ENDPOINTS.chat, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // Authorization 由 Vite proxy 服务端注入，不在此暴露
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Response body is empty");
  }

  return response.body;
}
