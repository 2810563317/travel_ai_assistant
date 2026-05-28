# Agent Flow: Travel AI Assistant

## 完整请求链路

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. 用户输入                                                      │
│    UI 输入框 → Enter 键 → handleSend()                          │
│    构造 UIMessage { role: "user", content: "三天东京行程" }       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Context 引擎（浏览器端，每次 API 调用前执行）                   │
│    sendToApi(userChatMsg):                                      │
│                                                                  │
│    a. updateMessage(window, { userMessage, assistantResponse }) │
│       → 上一轮 latestUser 推入 recentHistory                     │
│       → 上一轮 assistantResponse 推入 recentHistory              │
│       → 新消息成为 latestUser                                    │
│       → 若 recentHistory > 80k tokens: compressRecentHistory()  │
│       → 若 total > 112k tokens: hardTruncate()                  │
│                                                                  │
│    b. toModelMessages(window) → 5 层结构 ChatMessage[]:         │
│       [systemPrompt][userProfile][memorySummary][history][latest]│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. API 调用                                                      │
│    useMock=true  → createMockSSEStream(MOCK_TOKENS)             │
│    useMock=false → streamDeepSeekChat({ messages })             │
│      → POST /api/deepseek (Vite proxy → api.deepseek.com)      │
│      → Authorization: Bearer <key> (服务端注入)                  │
│    StreamSource → useStreamResponse.start(source)               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Tool Decision（LLM 内部）                                     │
│    LLM 判断是否需要调用工具：                                     │
│    - get_weather → 天气查询                                     │
│    - calculate_budget → 预算计算                                │
│    - search_hotels / search_flights / search_attractions        │
│                                                                  │
│    若需要 → 返回 tool_calls                                     │
│    若不需要 → 直接返回文本响应                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. Tool 执行 + 预处理                                            │
│    执行 tool → 获取原始结果                                      │
│    preprocessToolOutput(toolName, rawOutput):                   │
│      → JSON.parse                                               │
│      → 结果数量封顶 (maxResults)                                 │
│      → 字段白名单过滤 (keepFields)                               │
│      → token 预算裁剪 (maxTokens)                                │
│      → 硬截断上限 (SINGLE_MESSAGE_HARD_CAP = 4000)              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. LLM Response（流式输出）                                      │
│    SSE 格式:                                                    │
│    data: {"choices":[{"delta":{"content":"根据"}}]}             │
│    data: {"choices":[{"delta":{"content":"您的"}}]}             │
│    ...                                                          │
│    data: [DONE]                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. SSE 解析（前端）                                              │
│    parseSSEChunk(buffer):                                       │
│      → 按 "\n\n" 切分帧                                         │
│      → 解析 "data:" 行                                          │
│      → 提取 choices[0].delta.content                            │
│      → 输出 frames[]                                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 8. JSON 卡片检测                                                 │
│    processFrames(frames, detector):                             │
│                                                                  │
│    text 模式:                                                    │
│      → search(/\{"type"\s*:\s*"/)                              │
│      → 未匹配 → TextChunk                                       │
│      → 匹配 → 前面文本 TextChunk + 进入 json 模式                │
│                                                                  │
│    json 模式:                                                    │
│      → buffer += frame                                          │
│      → findJsonEnd(buffer) — 括号深度追踪                       │
│      → 未闭合 → 等待更多数据                                    │
│      → 闭合 → parseJsonChunk() → CardChunk 或 TextChunk        │
│      → 递归处理剩余部分                                          │
│                                                                  │
│    流结束 → flushJsonDetector():                                │
│      → JSON.parse 尝试 → CardChunk                              │
│      → 失败 → ErrorChunk("数据传输中断")                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 9. rAF 节流渲染                                                 │
│     scheduleFlush():                                             │
│       → 已安排? → 跳过                                           │
│       → 未安排 → requestAnimationFrame(flushChunks)             │
│                                                                  │
│     flushChunks():                                               │
│       → 取出 pendingChunksRef                                   │
│       → setState: fullText += TextChunk; chunks += all          │
│       → React 重渲染 (≤60fps)                                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 10. UI 渲染                                                      │
│     displayMessages → [...messages, streamingBubble]             │
│                                                                  │
│     ChatBubble:                                                  │
│       user → 纯文本                                              │
│       assistant → AssistantContent                               │
│                                                                  │
│     AssistantContent:                                            │
│       TextChunk[] → 合并 → react-markdown → Markdown 渲染       │
│       CardChunk → CardWidget → RouteCard / WeatherCard          │
│       ErrorChunk → ErrorWidget → 红色错误提示                   │
│       流式时 → sanitizeStreamingMarkdown() → 裁剪残缺语法       │
│       流式时 → 闪烁光标 ▍                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 11. 流结束处理                                                   │
│     useEffect: isLoading true→false, fullText 非空              │
│       → setMessages 固化 assistant 消息（移除 isStreaming 标记） │
│       → lastAssistantRef = assistant ChatMessage                 │
│       → 供下一轮 sendToApi → updateMessage 消费                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ 12. 下一轮对话                                                   │
│     用户再次输入 → handleSend() → sendToApi()                   │
│       → updateMessage 消费 lastAssistantRef（上一轮回复）        │
│       → 上下文窗口自然滑动，超出预算时压缩/截断                   │
│       → 返回步骤 1                                                │
└─────────────────────────────────────────────────────────────────┘
```

## 修正流程（用户点击"重规划"/"缩短行程"/"换个风格"）

```
1. 快照当前 partialContent + partialChunks
2. 固化被中断的 assistant 消息（标记 ~已中断~），追加用户修正指令
3. 根据剪枝策略设置 lastAssistantRef：
   - strip 策略 → lastAssistantRef 不变（partial 不进入 context 窗口）
   - annotate 策略 → lastAssistantRef = ~已中断~ 的 partial 消息
4. sendToApi(修正指令)：
   a. updateMessage 消费 lastAssistantRef（若有）→ 推入 recentHistory
   b. toModelMessages → 发送给 API
   c. streamResult.start(newSource) → 自动 abort 旧流 + 启动新流
```

## 流结束时固化

```
useEffect watches: isLoading (prev=true, current=false) && fullText
  → 将最后一个 streaming 气泡固化为普通消息
  → lastAssistantRef = 完整 assistant ChatMessage
  → 下一次 handleSend 时，updateMessage 消费此引用
```
