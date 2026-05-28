// ============================================================
// 上下文窗口架构 (Context Window Architecture)
// ============================================================
//
// 最终发送给模型的消息数组：
//   [systemPrompt, userProfile, memorySummary, ...recentHistory, latestUser]
//
// Token 预算分配示意（以 128k 上下文为例）：
//   ┌──────────────────────────────────────────────────────┐
//   │ systemPrompt        ~2k tokens   (静态，仅加载一次)    │
//   │ userProfile         ~1k tokens   (缓慢变化)            │
//   │ memorySummary       ~8k tokens   (压缩过程中渐进增长)  │
//   │ recentHistory      ~100k tokens   (滑动窗口)           │
//   │ latestUser          ~2k tokens   (始终保留，不截断)    │
//   │ response reserve   ~15k tokens   (留给模型输出)        │
//   └──────────────────────────────────────────────────────┘

import type { ChatMessage, UserProfile } from "../types/chatMessage";
import type { ContextConfig } from "../config/context";
import { DEFAULT_CONTEXT_CONFIG } from "../config/context";
import { estimateMessageTokens } from "./tokenEstimator";
import { preprocessToolMessages } from "../tools/toolPreprocessor";
import { compressRecentHistory } from "./compressor";
import { hardTruncate } from "./hardTruncate";

// ---- 核心类型 (core types) ----

export type ContextWindow = {
  systemPrompt: ChatMessage;
  /** 结构化的用户画像——唯一数据源。下方的 userProfile 是其格式化后的文本。 */
  profileData: UserProfile;
  /** 从 profileData 生成的 system 消息。画像变更时重新格式化。 */
  userProfile: ChatMessage;
  memorySummary: ChatMessage;
  recentHistory: ChatMessage[];
  latestUser: ChatMessage;
};

export type UpdateResult = {
  window: ContextWindow;
  didCompress: boolean;
  compressedCount: number;
};

// ---- token 估算 (re-export from tokenEstimator) ----

function estimateWindowTokens(window: ContextWindow): number {
  let total = 0;
  total += estimateMessageTokens(window.systemPrompt);
  total += estimateMessageTokens(window.userProfile);
  total += estimateMessageTokens(window.memorySummary);
  for (const msg of window.recentHistory) total += estimateMessageTokens(msg);
  total += estimateMessageTokens(window.latestUser);
  return total;
}

// ============================================================
// 核心：updateMessage —— 每轮对话调用一次
// ============================================================
//
// 接收当前上下文窗口、新用户消息、可选的 assistant 回复和 tool 结果，
// 返回更新后的窗口。内部自动处理压缩（compressRecentHistory）和保底截断（hardTruncate）。

export async function updateMessage(
  current: ContextWindow,
  incoming: {
    userMessage: ChatMessage;
    assistantResponse?: ChatMessage;
    toolResults?: ChatMessage[];
  },
  config: ContextConfig = DEFAULT_CONTEXT_CONFIG
): Promise<UpdateResult> {
  // ── 第1步：上一轮的 latestUser 退位，推入 recentHistory ──
  if (current.latestUser) {
    current.recentHistory.push(current.latestUser);
  }

  // ── 第2步：追加 assistant 回复和 tool 结果（tool 结果先经预处理裁剪）──
  if (incoming.assistantResponse) {
    current.recentHistory.push(incoming.assistantResponse);
  }
  if (incoming.toolResults) {
    current.recentHistory.push(...preprocessToolMessages(incoming.toolResults));
  }

  // ── 第3步：新用户消息成为 latestUser ──
  const newWindow: ContextWindow = {
    ...current,
    latestUser: incoming.userMessage,
  };

  // ── 第4步：检查 recentHistory 是否超出 token 上限，触发压缩 ──
  const historyTokens = newWindow.recentHistory.reduce(
    (sum, m) => sum + estimateMessageTokens(m),
    0
  );

  let didCompress = false;
  let compressedCount = 0;

  if (historyTokens > config.recentHistoryTokenLimit) {
    const result = await compressRecentHistory(newWindow, config);
    Object.assign(newWindow, result.window);
    didCompress = true;
    compressedCount = result.compressedCount;
  }

  // ── 第5步：最终安全检查 —— 压缩后仍超预算则硬截断 ──
  const totalTokens = estimateWindowTokens(newWindow);
  const availableTokens = config.maxContextTokens - config.responseReserveTokens;

  if (totalTokens > availableTokens) {
    await hardTruncate(newWindow, availableTokens, config);
  }

  return { window: newWindow, didCompress, compressedCount };
}
