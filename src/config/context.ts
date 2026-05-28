export type ContextConfig = {
  /** 整个上下文窗口的总 token 预算 */
  maxContextTokens: number;
  /** 为模型输出预留的 token */
  responseReserveTokens: number;
  /** recentHistory 的 token 上限，超出后触发压缩 */
  recentHistoryTokenLimit: number;
  /** memorySummary 的 token 上限 */
  memorySummaryTokenLimit: number;
  /** 每次压缩的批处理条数 */
  compressBatchSize: number;
  /** recentHistory 最少保留的消息条数（防止压缩过度导致上下文断裂） */
  minRecentMessages: number;
};

export const DEFAULT_CONTEXT_CONFIG: ContextConfig = {
  maxContextTokens: 128_000,
  responseReserveTokens: 16_000,
  recentHistoryTokenLimit: 80_000,
  memorySummaryTokenLimit: 8_000,
  compressBatchSize: 6, // 每次压缩约 3 对 user-assistant 往返
  minRecentMessages: 4,
};

/** 模型输出预留 token */
export const RESPONSE_RESERVE_TOKENS = 16_000;

/** 上下文窗口总 token 预算 */
export const MAX_CONTEXT_TOKENS = 128_000;
