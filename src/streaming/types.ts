/**
 * 普通文本片段
 *
 * 大模型输出的纯文本内容，最终会拼接到 fullText 中展示给用户。
 * 例如："你好，我来为你规划行程。" 这类自然语言文本。
 */
export type TextChunk = { kind: "text"; text: string };

/**
 * 解析成功的内嵌 JSON 卡片
 *
 * 当大模型在输出中嵌入 {"type":"route_card","data":{...}} 这样的结构化 JSON 时，
 * 会被状态机检测到并解析为此类型，而非直接拼入 fullText 让用户看到原始 JSON 源码。
 *
 * UI 层应根据 cardType 渲染对应的卡片组件（如 route_card → <RouteCard />）。
 *
 * @property cardType - JSON 中 type 字段的值，用于路由到对应的卡片组件
 * @property data      - 完整的 JSON 解析结果（包含 type 字段），卡片组件从中提取所需字段
 */
export type CardChunk = { kind: "card"; cardType: string; data: Record<string, unknown> };

/**
 * JSON 传输中断或解析失败的兜底
 *
 * 当流在中途断开（如网络问题），导致 JSON 块未能完整接收时生成。
 * UI 层应渲染一条温和的提示（如"行程卡片加载失败"），而非直接 crash。
 *
 * @property message - 面向用户的错误描述
 * @property raw     - 原始截断数据（调试用），仅在 showRaw=true 时包含完整内容，否则只含 200 字符预览
 */
export type ErrorChunk = { kind: "error"; message: string; raw?: string };

/**
 * 流中的一条内容，可能是文本、卡片或错误
 *
 * 这是 chunks 数组的元素类型。使用可辨识联合类型（discriminated union），
 * 通过 kind 字段区分具体类型。UI 层用 switch/case 分流渲染。
 */
export type StreamChunk = TextChunk | CardChunk | ErrorChunk;

/**
 * 流式响应的完整状态
 *
 * 整个状态由 useState 管理，每次 rAF 回调中通过 setState 的函数式更新合并新数据。
 *
 * @property fullText     - 纯文本内容累计（不含任何 JSON 源码），用于需要纯文本展示的场景
 * @property chunks       - 混合类型内容序列，按模型输出的原始顺序排列，用于精细化 UI 渲染
 * @property isLoading    - 流是否处于活跃状态（未关闭、未出错、未被取消）
 * @property error        - 顶层错误信息（网络错误、HTTP 错误等），与 ErrorChunk 不同：
 *                          ErrorChunk 是流内某一段 JSON 解析失败，而此字段是整个流的失败
 * @property firstChunkAt - 首个有意义内容到达的时间戳，用于计算首字节延迟（TTFB）
 */
export type StreamState = {
  fullText: string;
  chunks: StreamChunk[];
  isLoading: boolean;
  error: string | null;
  firstChunkAt: number | null;
};

/**
 * 流的数据来源
 *
 * - url:    传入 fetch URL，hook 内部执行 fetch 并读取 response.body
 * - stream: 外部已获取的 ReadableStream（如通过 Anthropic SDK 直接拿到 body），直接消费
 */
export type StreamSource =
  | { type: "url"; url: string; init?: RequestInit }
  | { type: "stream"; stream: ReadableStream<Uint8Array> };

/**
 * JSON 检测状态机的内部状态
 *
 * 此状态在单次流的 consumeStream 过程中保持（闭包变量），跨多个网络 chunk 持续工作。
 * 每次调用 processFrames 时传入同一个 state 对象，实现跨帧的状态记忆。
 *
 * 状态转换图：
 *   text ──{"type":"... 匹配成功──▶ json ──括号深度归零──▶ text（输出 CardChunk 或 TextChunk）
 *     ▲                                                                     │
 *     └────────────────────── 闭合括号后继续处理剩余文本 ◀─────────────────────┘
 */
export type JsonDetectorState = {
  mode: "text" | "json";
  buffer: string;
};
