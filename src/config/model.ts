/** DeepSeek 模型 */
export const DEEPSEEK_MODELS = {
  /** 通用对话模型 */
  chat: "deepseek-chat",
  /** 深度推理模型（R1） */
  reasoner: "deepseek-reasoner",
} as const;

/** 默认主模型 */
export const DEFAULT_MODEL: string = DEEPSEEK_MODELS.chat;

/** 快速模型 —— 用于摘要、画像提取等轻量任务 */
export const FAST_MODEL: string = DEEPSEEK_MODELS.chat;

/** API 请求超时（毫秒） */
export const DEFAULT_TIMEOUT_MS = 30_000;

/** 默认 API 端点路径（经 Vite proxy 转发到 DeepSeek） */
export const DEFAULT_API_ENDPOINT = "/api/deepseek/chat/completions";
