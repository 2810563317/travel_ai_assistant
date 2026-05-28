// ---- 模拟 LLM 流式响应（仅开发调试用） ----

/** 构造一段模拟的 SSE 字节流，每个 token 间隔 ~60ms，模拟真实 LLM 输出节奏 */
export function createMockSSEStream(
  tokens: string[],
  intervalMs = 60
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      for (const token of tokens) {
        // SSE 帧格式：data: + JSON + 双换行
        const frame = `data: ${JSON.stringify({
          choices: [{ delta: { content: token } }],
        })}\n\n`;
        controller.enqueue(encoder.encode(frame));
        await sleep(intervalMs);
      }
      // 发送结束信号
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 模拟流测试 tokens，覆盖三类极端场景：
 *
 *   场景 A「卡片夹心饼干」：文本 → route_card → 文本 → weather_card → 文本
 *     验证 processFrames 在 text/json 模式间反复切换、连续文本合并后
 *     react-markdown 渲染的完整性。
 *
 *   场景 B「格式崩坏」：budget_card JSON 故意缺少末尾的 }} 闭合符，
 *     验证流结束时 flushJsonDetector → ErrorChunk 降级逻辑，
 *     UI 显示"数据传输中断"而非白屏。
 *
 *   JSON 卡片被故意切割到多个 token 中（如 "route_" | "card"），
 *   验证 findJsonEnd 的跨帧拼接 + 括号深度追踪。
 */
export const MOCK_TOKENS = [
  // ════ 开场文本 ════
  "根据", "您的", "偏好", "，", "为您", "规划", "以下", "东京", "行程", "：\n\n",

  // ════ 场景 A-1: Route Card JSON（8 个 token 跨帧拼接）════
  '{"type":"route_',
  'card","data":{"title":"东京三日游","days":[',
  '{"day":1,"label":"Day 1","activities":[',
  '"抵达成田机场","入住新宿酒店","新宿御苑","思出横丁居酒屋"',
  ']},{"day":2,"label":"Day 2","activities":[',
  '"浅草寺 → 仲见世通","秋叶原电器街","晴空塔夜景"',
  ']},{"day":3,"label":"Day 3","activities":[',
  '"镰仓一日游：高德院大佛 → 长谷寺 → 江之岛"',
  ']}]}}\n\n',

  // ════ 场景 A-2: 夹在两个卡片之间的过渡文本 ════
  "以上", "为", "核心", "路线", "，", "涵盖", "东京", "市区", "及", "周边", "精华", "。\n\n",
  "接下来", "查看", "天气", "情况", "：\n\n",

  // ════ 场景 A-3: Weather Card JSON（5 个 token 跨帧拼接）════
  '{"type":"weather_',
  'card","data":{"city":"东京","forecast":[',
  '{"date":"5/28","condition":"晴","high":25,"low":18},',
  '{"date":"5/29","condition":"多云","high":26,"low":19},',
  '{"date":"5/30","condition":"晴间多云","high":27,"low":20}',
  "]}}\n\n",

  // ════ 场景 A-4: 卡片后的文本 ════
  "天气", "总体", "不错", "，", "适合", "出游", "。\n\n",
  "**", "费用", "参考", "**", "如下", "：\n\n",

  // ════ 场景 B: Budget Card JSON —— 末尾故意缺 }}  ════
  // JSON 结构应为 {"type":"budget_card","data":{...}}
  // 但这里最后两个 token 分别是 "]}" 和 "\n\n"，
  // 少了一个闭合 } — 流结束时 flushJsonDetector 应捕获并生成 ErrorChunk
  '{"type":"budget_',
  'card","data":{"total":85000,"currency":"JPY","breakdown":[',
  '{"category":"住宿","amount":24000},{"category":"交通","amount":15000},',
  '{"category":"餐饮","amount":20000},{"category":"门票","amount":10000}',
  "]}\n\n",
  // ↑ 末尾的 }} 缺少一层：flushJsonDetector 会尝试 JSON.parse 失败 → ErrorChunk
];
