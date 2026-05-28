import { estimateTokens } from "../context/tokenEstimator";
import type { ToolOutputConfig } from "../config/tools";
import { TOOL_OUTPUT_CONFIGS, DEFAULT_TOOL_CONFIG, SINGLE_MESSAGE_HARD_CAP } from "../config/tools";
import type { ChatMessage } from "../types/chatMessage";

function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in obj) result[f] = obj[f];
  }
  return result;
}

function applyHardCap(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const ratio = (text.length * maxTokens) / estimateTokens(text);
  return text.slice(0, Math.floor(ratio)) + "\n[...truncated]";
}

/** 从数组尾部逐条丢弃，直到 payload 的 token 数不超过 maxTokens。 */
function fitToBudget(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  let truncated = text;
  while (estimateTokens(truncated) > maxTokens && truncated.length > 100) {
    const chop = truncated.lastIndexOf("},{");
    if (chop < 0) break;
    truncated = truncated.slice(0, chop + 1) + "]";
  }
  return truncated;
}

export function preprocessToolOutput(toolName: string, rawContent: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    return applyHardCap(rawContent, SINGLE_MESSAGE_HARD_CAP);
  }

  const cfg: ToolOutputConfig = TOOL_OUTPUT_CONFIGS[toolName] ?? DEFAULT_TOOL_CONFIG;

  if (Array.isArray(parsed)) {
    let results = parsed.slice(0, cfg.maxResults);
    if (cfg.keepFields.length > 0) {
      results = results.map((item) => pickFields(item, cfg.keepFields));
    }
    // 标注原始总数，方便模型在需要时用 detail 接口回查
    const truncated = parsed.length > cfg.maxResults ? ` (${parsed.length} total)` : "";
    const payload = JSON.stringify(results);
    return fitToBudget(payload + truncated, cfg.maxTokens);
  }

  // 非数组（单个对象）
  let obj = parsed as Record<string, unknown>;
  if (cfg.keepFields.length > 0) {
    obj = pickFields(obj, cfg.keepFields);
  }
  return fitToBudget(JSON.stringify(obj), cfg.maxTokens);
}

export function preprocessToolMessages(toolResults: ChatMessage[]): ChatMessage[] {
  return toolResults.map((msg) => {
    if (msg.role !== "tool") return msg;
    const processed = preprocessToolOutput((msg as any).name, (msg as any).content);
    return { ...msg, content: processed } as any;
  });
}
