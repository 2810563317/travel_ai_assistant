/** DeepSeek API 配置 */

/** 通过 Vite proxy 转发，避免 CORS。API Key 由 proxy 注入，前端不持有。 */
export const DEEPSEEK_BASE_URL = "/api/deepseek";

export const DEEPSEEK_ENDPOINTS = {
  chat: `${DEEPSEEK_BASE_URL}/chat/completions`,
} as const;
