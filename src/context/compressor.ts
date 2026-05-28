import type { ChatMessage } from "../types/chatMessage";
import type { ContextWindow } from "./updateMessage";
import type { ContextConfig } from "../config/context";
import { estimateTokens, estimateMessageTokens } from "./tokenEstimator";
import { findAtomicBoundary } from "./atomicBoundary";

/** 将一组对话消息压缩为一段叙事性摘要，与已有摘要合并。 */
export async function summarizeMessages(
  messages: ChatMessage[],
  existingSummary: string
): Promise<{ summary: string; keyFacts: string[] }> {
  // 实际接入：
  //   const response = await llm.invoke({
  //     messages: [
  //       { role: "system", content: SUMMARIZE_PROMPT },
  //       { role: "user", content: `已有摘要：\n${existingSummary}\n\n新消息：\n${formatMessages(messages)}` }
  //     ]
  //   });
  //   return parseSummaryResponse(response);

  // 占位实现
  return {
    summary: `[compressed ${messages.length} messages] ${existingSummary}`,
    keyFacts: [],
  };
}

/**
 * 从 recentHistory 头部取出最旧的 N 条消息，调用 LLM 蒸馏为摘要，
 * 合并到 memorySummary。这是"优雅遗忘"的核心机制。
 */
export async function compressRecentHistory(
  window: ContextWindow,
  config: ContextConfig
): Promise<{ window: ContextWindow; compressedCount: number }> {
  const { recentHistory, memorySummary } = window;

  // ── 确定本次压缩的消息数量 ──
  // 取最旧的 compressBatchSize 条，但保留 minRecentMessages 条在 recentHistory 中。
  // 最终切割点还需对齐到原子边界（不切割 tool-call 组）。
  const rawSliceEnd = Math.min(
    config.compressBatchSize,
    recentHistory.length - config.minRecentMessages
  );
  if (rawSliceEnd <= 0) {
    // 消息不足或已达最小保留数，跳过本轮压缩
    return { window, compressedCount: 0 };
  }

  const sliceEnd = findAtomicBoundary(recentHistory, rawSliceEnd);
  if (sliceEnd === 0) {
    // 整批是一个不可切割的 tool-call 组，本轮跳过
    return { window, compressedCount: 0 };
  }

  const messagesToCompress = recentHistory.splice(0, sliceEnd);

  // ── 调用 LLM 蒸馏摘要 ──
  const existingSummary =
    "content" in memorySummary ? (memorySummary as any).content : "";
  const { summary } = await summarizeMessages(
    messagesToCompress,
    existingSummary
  );

  // ── 更新 memorySummary ──
  const updatedSummary: ChatMessage = {
    ...memorySummary,
    content: summary,
  } as any;

  // ── 递归压缩：如果摘要本身超出 token 上限，对摘要再做摘要 ──
  let finalSummary = updatedSummary;
  if (estimateTokens(summary) > config.memorySummaryTokenLimit) {
    const compressed = await summarizeMessages(
      [{ role: "user", content: summary } as any],
      "" // 从头开始 —— 旧摘要的内容已包含在新摘要中
    );
    finalSummary = { ...memorySummary, content: compressed.summary } as any;
  }

  return {
    window: { ...window, recentHistory, memorySummary: finalSummary },
    compressedCount: sliceEnd,
  };
}
