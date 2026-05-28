import type { ChatMessage } from "../types/chatMessage";
import type { UserProfile } from "../types/chatMessage";
import type { ProfilePatch } from "../types/profile";
import type { ContextWindow } from "./updateMessage";
import type { ContextConfig } from "../config/context";
import { estimateMessageTokens } from "./tokenEstimator";
import { measureRemovalGroup } from "./atomicBoundary";
import { mergeProfile } from "../profile/mergeProfile";
import { formatUserProfile } from "../profile/formatter";
import userProfilePromptRaw from "../prompts/userProfilePrompt.md?raw";
import { renderPrompt } from "../prompts/promptLoader";

/**
 * 轻量级关键事实提取 —— 比 summarizeMessages 更轻量。
 * 目标不是生成叙事性摘要，而是抢救无法结构化的即时偏好/决定/上下文。
 *
 * 实际接入时使用快速模型（如 Haiku），prompt 方向：
 *   "仅提取必须记住的可操作事实。跳过寒暄和已解决的问题。
 *    捕获类型：本次行程偏好/约束、已做出的决定（日期、预算、酒店选择）、未解决的问题。
 *    以子弹列表返回。"
 */
export async function extractKeyFacts(messages: ChatMessage[]): Promise<string | null> {
  // 占位 —— 接入时替换为实际 LLM 调用
  return null;
}

/**
 * 从即将被删除的消息中提取结构化的用户偏好变更。
 *
 * 设计目标：
 * - 轻量级：使用快速模型（如 Haiku），只提取可映射到 UserProfile 字段的信息
 * - 保守提取：只在置信度较高时才返回 patch，避免污染 profile
 * - 互补分工：能结构化的走这里（进 system prompt），不能结构化的走 extractKeyFacts（进 memorySummary）
 *
 * @returns ProfilePatch 仅包含有变更的字段；无变更或信息不足时返回 null
 */
export async function updateProfileQuickly(
  messages: ChatMessage[],
  currentProfile: UserProfile
): Promise<ProfilePatch | null> {
  // 接入真实 LLM 时使用已加载的 userProfilePromptRaw 模板：
  //
  //   const systemPrompt = renderPrompt(userProfilePromptRaw, {
  //     current_profile: JSON.stringify(currentProfile, null, 2),
  //   });
  //   const userContent = messages.map(m => `${m.role}: ${(m as any).content ?? ""}`).join("\n\n");
  //   const response = await fastLlm.invoke({ system: systemPrompt, messages: [{ role: "user", content: userContent }] });
  //   return JSON.parse(response) as ProfilePatch;

  return null;
}

/** 将 ProfilePatch 应用到 ContextWindow，并重新格式化 userProfile 系统消息。 */
export function applyProfilePatch(window: ContextWindow, patch: ProfilePatch): void {
  const updated = mergeProfile(window.profileData, patch);
  if (updated === window.profileData) return; // 无实际变更，跳过

  window.profileData = updated;
  window.userProfile = {
    ...window.userProfile,
    content: formatUserProfile(updated),
  };
}

/**
 * 硬截断：上下文窗口的最后安全阀。
 *
 * 当压缩后仍然超出预算时，物理性地从 recentHistory 头部删除消息。
 * 删除前会执行"偏好收割"和"关键事实提取"以尽量减少信息损失。
 * 三阶段流程：扫描收集 → 偏好收割 + 事实提取 → 物理删除
 */
export async function hardTruncate(
  window: ContextWindow,
  tokenBudget: number,
  config: ContextConfig
): Promise<void> {
  const staticTokens =
    estimateMessageTokens(window.systemPrompt) +
    estimateMessageTokens(window.userProfile) +
    estimateMessageTokens(window.memorySummary) +
    estimateMessageTokens(window.latestUser);

  let remainingTokens = window.recentHistory.reduce(
    (s, m) => s + estimateMessageTokens(m),
    0
  );

  // ── 阶段1：只扫描收集，不修改数组 ──
  let cursor = 0;
  let removeTotal = 0;

  while (
    window.recentHistory.length - removeTotal > config.minRecentMessages &&
    staticTokens + remainingTokens > tokenBudget
  ) {
    const groupSize = measureRemovalGroup(window.recentHistory, cursor);

    for (let i = 0; i < groupSize; i++) {
      remainingTokens -= estimateMessageTokens(window.recentHistory[cursor + i]);
    }

    removeTotal += groupSize;
    cursor += groupSize;
  }

  if (removeTotal === 0) return;

  const messagesToRemove = window.recentHistory.slice(0, removeTotal);

  // ── 阶段2a：收割结构化偏好变更 ──
  const profilePatch = await updateProfileQuickly(messagesToRemove, window.profileData);
  if (profilePatch) {
    applyProfilePatch(window, profilePatch);
  }

  // ── 阶段2b：剩余信息以文本形式抢救 ──
  const facts = await extractKeyFacts(messagesToRemove);
  if (facts) {
    const existing =
      "content" in window.memorySummary
        ? (window.memorySummary as any).content
        : "";
    window.memorySummary = {
      ...window.memorySummary,
      content: `${existing}\n\n[Saved from truncated history]\n${facts}`,
    } as any;
  }

  // ── 阶段3：物理删除 ──
  window.recentHistory.splice(0, removeTotal);
}
