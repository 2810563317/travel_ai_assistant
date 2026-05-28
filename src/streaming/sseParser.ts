/**
 * 从原始字节流累积缓冲区中按 SSE 协议切出完整的 data 帧。
 *
 * 大模型 API（OpenAI / Anthropic 等）通常返回 SSE 格式的流式响应：
 *   data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"你好"}}]}
 *   data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"，世界"}}]}
 *   data: [DONE]
 *
 * 核心挑战：TCP 是字节流，一个 data 帧可能被切割到多个网络 chunk 中。
 * 本函数通过在调用方维护跨 chunk 的 buffer 来解决：每次将新字节追加到 buffer，
 * 按 "\n\n"（SSE 帧分隔符）切割，最后一段不完整的保留为 remainder 等待下次补齐。
 *
 * 兼容性：非 SSE 格式的纯文本流也可处理——不以 "data:" 开头的行直接视为模型输出内容。
 *
 * @param buffer - 累积的原始文本缓冲区（跨 chunk）
 * @returns frames    - 本次成功解析出的内容帧数组
 *          remainder - 不完整的最后一段，应保留到下次调用时拼在前面
 */
export function parseSSEChunk(buffer: string): { frames: string[]; remainder: string } {
  const frames: string[] = [];

  // SSE 帧之间以空行分隔（"\n\n"），切分后最后一段可能不完整
  const segments = buffer.split("\n\n");

  // 最后一段是不完整的帧片段，需保留到下次与后续 chunk 拼接
  const remainder = segments.pop() ?? "";

  for (const seg of segments) {
    // 一个 SSE 帧内部可能有多个 field 行（event / data / id / retry）
    const lines = seg.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // 流结束信号，直接跳过
      if (trimmed === "data: [DONE]") continue;

      if (trimmed.startsWith("data: ")) {
        // 标准 SSE data 行：去掉 "data: " 前缀后尝试以 JSON 解析
        const payload = trimmed.slice("data: ".length);
        try {
          // OpenAI 格式：choices[0].delta.content
          const json = JSON.parse(payload);
          const content = json.choices?.[0]?.delta?.content;
          if (content) frames.push(content);
        } catch {
          // 非 JSON 的 data 行（如某些代理返回的纯文本），直接把 payload 当作内容
          frames.push(payload);
        }
      } else if (
        trimmed.startsWith("event:") ||
        trimmed.startsWith("id:") ||
        trimmed.startsWith("retry:")
      ) {
        // SSE 协议控制帧，不携带内容，跳过
        continue;
      } else {
        // 不以 "data:" / "event:" / "id:" / "retry:" 开头 → 视为纯文本流
        frames.push(trimmed);
      }
    }
  }

  return { frames, remainder };
}
